require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let pool;
async function getPool(){
  if(pool && pool.connected) return pool;
  pool = await sql.connect(sqlConfig);
  return pool;
}

// TEST - entra a https://tu-dominio.com/api/test
app.get('/api/test', async(req,res)=>{
  try{
    const p = await getPool();
    const r = await p.request().query('SELECT DB_NAME() as db, SUSER_SNAME() as usuario');
    res.json({ok:true,...r.recordset[0], env: {DB_USER: sqlConfig.user, DB_SERVER: sqlConfig.server, DB_NAME: sqlConfig.database}});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.post('/api/pedidos', async(req,res)=>{
  const d = req.body;
  console.log('Pedido recibido:', d.nombre, d.telefono);
  try{
    const p = await getPool();
    // CVE corto numérico
    let tel = (d.telefono||'').toString().replace(/\D/g,'');
    if(tel.length<5) tel = 'W'+Date.now().toString().slice(-8);
    const cve = tel.substring(0,20);

    // 1. CLIENTE - sin FKs que truenen
    await p.request()
   .input('cve', sql.VarChar(20), cve)
   .input('des', sql.VarChar(100), (d.nombre||'CLIENTE WEB').substring(0,100))
   .input('dir', sql.VarChar(200), (d.direccion||'').substring(0,200))
   .input('tel', sql.VarChar(30), (d.telefono||'').substring(0,30))
   .input('col', sql.VarChar(100), (d.colonia||'').substring(0,100))
   .query(`
      IF NOT EXISTS(SELECT 1 FROM dbo.C_CLIENTE WHERE CVE_CTE=@cve)
        INSERT INTO dbo.C_CLIENTE (CVE_CTE, DES_CTE, DIR_CTE, TEL_CTE, TIPO_CTE, COLONIA, FEC_ALTA)
        VALUES (@cve, @des, @dir, @tel, 'WEB', @col, GETDATE())
      ELSE
        UPDATE dbo.C_CLIENTE SET DES_CTE=@des, DIR_CTE=@dir, TEL_CTE=@tel WHERE CVE_CTE=@cve
    `);

    // 2. FOLIO
    const fr = await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM dbo.TH_PEDIDO WHERE TIPO_PED='WEB'`);
    const folio = fr.recordset[0].folio;

    // 3. PEDIDO - solo columnas base que sí existen en todos los SYSPTV
    await p.request()
   .input('folio', sql.Int, folio)
   .input('cve', sql.VarChar(20), cve)
   .input('tot', sql.Decimal(18,2), parseFloat(d.total||43))
   .input('obs', sql.VarChar(500), `WEB ${d.nombre} ${d.direccion} GPS:${d.lat||''},${d.lng||''}`.substring(0,500))
   .query(`
      INSERT INTO dbo.TH_PEDIDO (ID_SUCURSAL, TIPO_PED, NUM_PED, CVE_CTE, FEC_PED, TOT_PED, OBS_PED)
      VALUES (1, 'WEB', @folio, @cve, GETDATE(), @tot, @obs)
    `);

    console.log('Pedido WEB guardado:', folio);
    res.json({ok:true, folio, cve});

  }catch(err){
    console.error('ERROR SQL:', err.message);
    res.status(500).json({ok:false, error: err.message, stack: err.message});
  }
});

app.get('/', (req,res)=> res.send('Tienda OK - usa /api/test'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Corriendo', PORT));