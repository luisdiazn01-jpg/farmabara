require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let pool;
async function getPool(){
  if(pool && pool.connected) return pool;
  pool = await new sql.ConnectionPool(sqlConfig).connect();
  console.log('SYSPTV conectado en', process.env.DB_DATABASE);
  return pool;
}

app.get('/api/productos', async (req,res)=>{
  try{
    const p = await getPool();
    let r = await p.request().query(`
      SELECT TOP 200 CVE_ART as codigo, DES_ART as nombre, PRE_ART as precio, EXISTENCIA as existencia, CVE_FAM as categoria
      FROM C_ARTICULO ORDER BY DES_ART
    `);
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error: e.message}); }
});

app.post('/api/pedido-web', async (req,res)=>{
  try{
    const pool = await getPool();
    const { productos, total, nombre, telefono, direccion, lat, lng, colonia, referencia } = req.body;
    const telClean = (telefono+'').replace(/\D/g,'').slice(-10);
    const cveWeb = `WEB${telClean}`;
    const maps = (lat && lng)? `https://www.google.com/maps?q=${lat},${lng}` : null;
    const nombreUpper = (nombre||'CLIENTE WEB').toUpperCase().substring(0,80);

    let r = await pool.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as f FROM TH_PEDIDO WHERE ID_SUCURSAL=1 AND TIPO_PED='WEB'`);
    const folio = r.recordset[0].f;

    await pool.request()
    .input('cve', sql.VarChar, cveWeb)
    .input('des', sql.VarChar, nombreUpper)
    .input('tel', sql.VarChar, telefono)
    .input('dir', sql.VarChar, (direccion||'').substring(0,200))
    .query(`IF NOT EXISTS (SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE, DES_CTE, TEL_CTE, DIR_CTE) VALUES (@cve, @des, @tel, @dir) ELSE UPDATE C_CLIENTE SET DES_CTE=@des, TEL_CTE=@tel, DIR_CTE=@dir WHERE CVE_CTE=@cve`);

    await pool.request()
    .input('folio', sql.Int, folio)
    .input('cve', sql.VarChar, cveWeb)
    .query(`INSERT INTO TH_PEDIDO (ID_SUCURSAL, ID_EMP, TIPO_PED, NUM_PED, FEC_PED, CVE_CTE, FEC_ENT, IVA, CVE_VEN, CVE_TIP, SU_PED) VALUES (1, '001', 'WEB', @folio, GETDATE(), @cve, GETDATE(), 16.00, 'WEB', 1, ${total||0})`);

    for(const prod of productos){
      try{
        await pool.request()
        .input('folio', sql.Int, folio)
        .input('cod', sql.VarChar, prod.codigo)
        .input('cant', sql.Decimal(10,2), prod.cantidad||1)
        .input('pre', sql.Decimal(12,2), prod.precio||0)
        .query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL, TIPO_PED, NUM_PED, COD_ART, CANT, PRE_VTA) VALUES (1, 'WEB', @folio, @cod, @cant, @pre)`);
      }catch(e){
        await pool.request().input('folio', sql.Int, folio).input('cod', sql.VarChar, prod.codigo).input('cant', sql.Decimal(10,2), prod.cantidad||1).query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL, TIPO_PED, NUM_PED, COD_ART, CANT) VALUES (1, 'WEB', @folio, @cod, @cant)`);
      }
    }

    await pool.request()
    .input('folio', sql.Int, folio).input('cve', sql.VarChar, cveWeb).input('nom', sql.NVarChar, nombre).input('tel', sql.VarChar, telefono).input('dir', sql.NVarChar, direccion).input('lat', sql.Decimal(10,7), lat||null).input('lng', sql.Decimal(10,7), lng||null).input('maps', sql.VarChar, maps).input('col', sql.VarChar, colonia||'').input('ref', sql.NVarChar, referencia||'').input('ip', sql.VarChar, req.headers['x-forwarded-for']||req.ip||'')
    .query(`INSERT INTO PedidosWeb_Mapping (id_sucursal, num_ped, cliente_web_id, nombre_web, telefono_web, direccion_web, fecha, lat, lng, maps_url, ip_cliente, colonia, referencia) VALUES (1, @folio, @cve, @nom, @tel, @dir, GETDATE(), @lat, @lng, @maps, @ip, @col, @ref)`);

    return res.json({ok:true, folio, cve_cte:cveWeb, maps_url: maps});
  }catch(e){
    console.error('ERROR PEDIDO WEB:', e);
    return res.status(500).json({error: e.message, stack: e.stack});
  }
});

app.get('/api/health', (req,res)=> res.json({ok:true}));
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`SYSPTV corriendo en ${PORT}`));