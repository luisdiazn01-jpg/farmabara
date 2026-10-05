const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let pool;
async function getPool(){
  if(pool && pool.connected) return pool;
  pool = await sql.connect(config);
  return pool;
}

// Asegurar tabla puente con ubicación
async function ensureTable(){
  try{
    const p = await getPool();
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PedidosWeb_Mapping' AND xtype='U')
      CREATE TABLE PedidosWeb_Mapping (
        id INT IDENTITY(1,1) PRIMARY KEY,
        id_sucursal INT,
        num_ped INT,
        nombre_web NVARCHAR(150),
        telefono_web VARCHAR(20),
        direccion_web NVARCHAR(300),
        lat DECIMAL(10,7) NULL,
        lng DECIMAL(10,7) NULL,
        maps_url VARCHAR(500) NULL,
        ip_cliente VARCHAR(45) NULL,
        colonia VARCHAR(100) NULL,
        referencia NVARCHAR(200) NULL,
        fecha DATETIME DEFAULT GETDATE()
      );
    `);
    console.log('PedidosWeb_Mapping OK');
  }catch(e){ console.error('Error tabla puente', e.message); }
}
ensureTable();

// API PEDIDO - AMARRA C_CLIENTE + UBICACION
app.post('/api/pedido-web', async (req,res)=>{
  const { productos, total, nombre, telefono, direccion, colonia, referencia, lat, lng } = req.body;
  if(!productos ||!telefono) return res.status(400).json({error:'Faltan datos'});
  const transaction = new sql.Transaction(await getPool());
  try{
    await transaction.begin();
    const telLimpio = (telefono+'').replace(/\D/g,'').slice(-10);
    const cveWeb = `WEB${telLimpio}`;
    const nombreWeb = (nombre||'CLIENTE WEB').toUpperCase().substring(0,80);
    const dirWeb = (direccion||'').substring(0,150);
    const ipCliente = (req.headers['x-forwarded-for'] || req.ip || '').toString().substring(0,45);
    const mapsUrl = (lat && lng)? `https://www.google.com/maps?q=${lat},${lng}` : null;

    await new sql.Request(transaction)
     .input('cve', sql.VarChar, cveWeb)
     .input('des', sql.VarChar, nombreWeb)
     .input('dir', sql.VarChar, dirWeb)
     .input('tel', sql.VarChar, telefono)
     .query(`
        IF NOT EXISTS (SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve)
          INSERT INTO C_CLIENTE (CVE_CTE, DES_CTE, DIR_CTE, TEL_CTE, TIPO_CTE)
          VALUES (@cve, @des, @dir, @tel, 'WEB')
        ELSE
          UPDATE C_CLIENTE SET DES_CTE=@des, DIR_CTE=@dir, TEL_CTE=@tel WHERE CVE_CTE=@cve
      `);

    let r = await new sql.Request(transaction).query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as f FROM TH_PEDIDO WHERE ID_SUCURSAL=1`);
    const folio = r.recordset[0].f;

    await new sql.Request(transaction)
     .input('folio', sql.Int, folio)
     .input('cve', sql.VarChar, cveWeb)
     .input('total', sql.Decimal(12,2), total)
     .query(`INSERT INTO TH_PEDIDO (ID_SUCURSAL, NUM_PED, FEC_PED, CVE_CTE, TIPO_PED, ID_EMP, SU_PED, TOT_PED, IVA, DESC_CTE) VALUES (1, @folio, GETDATE(), @cve, 'WEB', '001', @total, @total, 0, 0)`);

    for(const p of productos){
      await new sql.Request(transaction)
       .input('folio', sql.Int, folio)
       .input('cod', sql.VarChar, (p.codigo||'').toString())
       .input('cant', sql.Decimal(10,2), p.cantidad||1)
       .input('prec', sql.Decimal(10,2), p.precio||0)
       .query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL, NUM_PED, COD_ART, CANT, PRECIO) VALUES (1, @folio, @cod, @cant, @prec)`);
    }

    await new sql.Request(transaction)
     .input('suc', sql.Int, 1)
     .input('folio', sql.Int, folio)
     .input('nombre', sql.NVarChar, nombreWeb)
     .input('tel', sql.VarChar, telefono)
     .input('dir', sql.NVarChar, dirWeb)
     .input('lat', sql.Decimal(10,7), lat||null)
     .input('lng', sql.Decimal(10,7), lng||null)
     .input('maps', sql.VarChar, mapsUrl)
     .input('ip', sql.VarChar, ipCliente)
     .input('col', sql.VarChar, (colonia||'').substring(0,100))
     .input('ref', sql.NVarChar, (referencia||'').substring(0,200))
     .query(`INSERT INTO PedidosWeb_Mapping (id_sucursal, num_ped, nombre_web, telefono_web, direccion_web, lat, lng, maps_url, ip_cliente, colonia, referencia) VALUES (@suc, @folio, @nombre, @tel, @dir, @lat, @lng, @maps, @ip, @col, @ref)`);

    await transaction.commit();
    res.json({ok:true, folio, cve_cte:cveWeb, maps_url: mapsUrl});
  }catch(e){
    try{ await transaction.rollback(); }catch(_){}
    console.error(e); res.status(500).json({error:e.message});
  }
});

app.get('/api/pedidos-web', async (req,res)=>{
  const p = await getPool();
  const r = await p.request().query(`
    SELECT h.NUM_PED as folio, h.FEC_PED as fecha, h.CVE_CTE, c.DES_CTE as cliente, c.TEL_CTE as telefono, ISNULL(h.TOT_PED, h.SU_PED) as total, m.direccion_web, m.colonia, m.referencia, m.lat, m.lng, m.maps_url, m.ip_cliente
    FROM TH_PEDIDO h JOIN C_CLIENTE c ON c.CVE_CTE=h.CVE_CTE LEFT JOIN PedidosWeb_Mapping m ON m.num_ped=h.NUM_PED AND m.id_sucursal=h.ID_SUCURSAL
    WHERE h.TIPO_PED='WEB' ORDER BY h.FEC_PED DESC
  `);
  res.json(r.recordset);
});

// RUTAS PARA /public - ARREGLA Cannot GET /
app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'API no encontrada'});
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT ||