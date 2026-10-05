require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const sql = require('mssql');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sqlConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASS || process.env.DB_PASSWORD || '',
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME || 'tiendaMaster',
  port: parseInt(process.env.DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true }
};

let pool = null;
async function getPool() {
  if (pool && pool.connected) return pool;
  if (pool) try { await pool.close(); } catch {}
  pool = await sql.connect(sqlConfig);
  console.log('BD CONECTADA:', sqlConfig.database);
  return pool;
}

app.get('/api/health', (req,res)=> res.json({ok:true}));

app.get('/api/debug-crart', async(req,res)=>{
  try{
    const p = await getPool();
    const total = await p.request().query(`SELECT COUNT(*) as total FROM dbo.CRART`);
    const top = await p.request().query(`SELECT TOP 5 RTRIM(Articulo) as cve, RTRIM(nombre) as nombre, [Precio] as precio FROM dbo.CRART`);
    res.json({ total: total.recordset[0], top5_con_precio: top.recordset });
  }catch(e){ res.json({error:e.message, detalle:e.originalError?.message}); }
});

// QUERY FINAL CON TU COLUMNA Precio
app.get('/api/productos', async(req,res)=>{
  try{
    const p = await getPool();
    const queryReal = `SELECT TOP 500 RTRIM(Articulo) as cve, RTRIM(nombre) as nombre, ISNULL(CAST([Precio] as decimal(18,2)),0) as precio FROM dbo.CRART WHERE LTRIM(RTRIM(nombre))<>'' ORDER BY Articulo`;
    console.log('QUERY:', queryReal);
    const r = await p.request().query(queryReal);
    console.log('PRODUCTOS:', r.recordset.length);
    res.json(r.recordset);
  }catch(e){
    console.error('ERROR PRODUCTOS:', e.message);
    res.status(500).json({error:e.message, detalle:e.originalError?.message});
  }
});

app.get('/api/config', async(req,res)=>{ try{ const p=await getPool(); const r=await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`); res.json(r.recordset[0]||{});}catch{res.json({})}});
app.post('/api/config', async(req,res)=>{ try{ const c=req.body; const p=await getPool(); await p.request().input('suc', sql.SmallInt, c.ID_SUCURSAL||1).input('emp', sql.Char(10), c.ID_EMP||'01').input('tal', sql.Char(10), c.CVE_TAL||'01').input('alm', sql.Char(10), c.NUM_ALM||'01').input('ven', sql.Char(10), c.CVE_VEN||'01').input('tipo', sql.Char(10), c.TIPO_PED||'WEB').input('wa', sql.VarChar(20), c.WHATSAPP_REPARTO||'').input('nom', sql.VarChar(100), c.NOMBRE_TIENDA||'').query(`UPDATE CFG_TIENDA_WEB SET ID_SUCURSAL=@suc, ID_EMP=@emp, CVE_TAL=@tal, NUM_ALM=@alm, CVE_VEN=@ven, TIPO_PED=@tipo, WHATSAPP_REPARTO=@wa, NOMBRE_TIENDA=@nom WHERE ID=1`); res.json({ok:true}); }catch(e){ res.status(500).json({error:e.message}); }});

async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool();
    const cfgQ=await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`);
    const cfg=cfgQ.recordset[0];
    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre=(d.nombre||'CLIENTE WEB').slice(0,100);
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre).query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE) VALUES (@cve,@des)`);
    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM TH_PEDIDO WHERE ID_SUCURSAL=${cfg.ID_SUCURSAL} AND ID_EMP='${String(cfg.ID_EMP).trim()}' AND TIPO_PED='${String(cfg.TIPO_PED).trim()}'`);
    const folio=fr.recordset[0].folio;
    const tot=parseFloat(d.total||0);
    await p.request().input('suc', sql.SmallInt, cfg.ID_SUCURSAL).input('emp', sql.Char(10), String(cfg.ID_EMP).trim()).input('tipo', sql.Char(10), String(cfg.TIPO_PED).trim()).input('folio', sql.BigInt, folio).input('cve', sql.VarChar(20), tel).input('tot', sql.Decimal(18,2), tot).query(`INSERT INTO TH_PEDIDO (ID_SUCURSAL,ID_EMP,TIPO_PED,NUM_PED,FEC_PED,CVE_CTE,STA_PED,SUB_TOT,TOT_PED) VALUES (@suc,@emp,@tipo,@folio,GETDATE(),@cve,'P',@tot,@tot)`);
    let par=1; for(const prod of d.productos||[]){ await p.request().input('suc', sql.SmallInt, cfg.ID_SUCURSAL).input('emp', sql.Char(10), String(cfg.ID_EMP).trim()).input('folio', sql.BigInt, folio).input('par', sql.Int, par++).input('cve', sql.Char(20), (prod.cve||'ART').toString().slice(0,20)).input('can', sql.Decimal(18,3), parseFloat(prod.cantidad||1)).input('pre', sql.Decimal(18,2), parseFloat(prod.precio||0)).query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,NUM_PAR,CVE_PRO,CAN_PRO,PRE_PRO,CAN_AUT) VALUES (@suc,@emp,@folio,@par,@cve,@can,@pre,@can)`);} res.json({ok:true, folio, wa:cfg.WHATSAPP_REPARTO}); }catch(e){ res.status(500).json({ok:false, error:e.message}); }
}
app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.post('/api/pedido', guardarPedido);
app.get('*', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(process.env.PORT||3000, ()=>console.log('V12 con [Precio] corriendo'));
