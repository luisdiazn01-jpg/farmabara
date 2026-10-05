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
  user: process.env.DB_USER,
  password: process.env.DB_PASS || process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 5, min: 0 }
};

let pool = null;
async function getPool(){
  if(pool && pool.connected) return pool;
  try{
    pool = await sql.connect(sqlConfig);
    // Crear config si no existe - sin tumbar si falla
    try{
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='CFG_TIENDA_WEB' AND xtype='U')
        CREATE TABLE dbo.CFG_TIENDA_WEB (ID INT PRIMARY KEY, ID_SUCURSAL SMALLINT DEFAULT 1, ID_EMP CHAR(10) DEFAULT '01', CVE_TAL CHAR(10) DEFAULT '01', NUM_ALM CHAR(10) DEFAULT '01', CVE_VEN CHAR(10) DEFAULT '01', TIPO_PED CHAR(10) DEFAULT 'WEB', WHATSAPP_REPARTO VARCHAR(20) DEFAULT '525500000000', NOMBRE_TIENDA VARCHAR(100) DEFAULT 'TIENDA WEB - SYSPTV');
        IF NOT EXISTS (SELECT 1 FROM dbo.CFG_TIENDA_WEB WHERE ID=1) INSERT INTO dbo.CFG_TIENDA_WEB (ID) VALUES (1);
      `);
    }catch(e){ console.log('CFG ya existe o no se pudo crear:', e.message); }
    console.log('BD OK:', sqlConfig.database);
    return pool;
  }catch(e){
    console.error('ERROR CONEXION BD:', e.message);
    throw e;
  }
}

app.get('/api/health', (req,res)=> res.json({ok:true, time:new Date()}));

app.get('/api/config', async(req,res)=>{ try{ const p=await getPool(); const r=await p.request().query(`SELECT * FROM dbo.CFG_TIENDA_WEB WHERE ID=1`); res.json(r.recordset[0]); }catch(e){ res.status(500).json({error:e.message}); }});
app.post('/api/config', async(req,res)=>{ try{ const c=req.body; const p=await getPool(); await p.request().input('suc', sql.SmallInt, c.ID_SUCURSAL||1).input('emp', sql.Char(10), c.ID_EMP||'01').input('tal', sql.Char(10), c.CVE_TAL||'01').input('alm', sql.Char(10), c.NUM_ALM||'01').input('ven', sql.Char(10), c.CVE_VEN||'01').input('tipo', sql.Char(10), c.TIPO_PED||'WEB').input('wa', sql.VarChar(20), c.WHATSAPP_REPARTO||'').input('nom', sql.VarChar(100), c.NOMBRE_TIENDA||'').query(`UPDATE dbo.CFG_TIENDA_WEB SET ID_SUCURSAL=@suc, ID_EMP=@emp, CVE_TAL=@tal, NUM_ALM=@alm, CVE_VEN=@ven, TIPO_PED=@tipo, WHATSAPP_REPARTO=@wa, NOMBRE_TIENDA=@nom WHERE ID=1`); res.json({ok:true}); }catch(e){ res.status(500).json({error:e.message}); }});

app.get('/api/debug-crart', async(req,res)=>{
  try{
    const p=await getPool();
    const r=await p.request().query(`SELECT TOP 5 CVE_PRO, DES_PRO, ESTATUS, PRE_VTA1 FROM dbo.CRART`);
    const d=await p.request().query(`SELECT DISTINCT ESTATUS FROM dbo.CRART`);
    res.json({ejemplos: r.recordset, distintos: d.recordset});
  }catch(e){ res.json({error:e.message, stack:e.originalError?.message}); }
});

app.get('/api/productos', async(req,res)=>{
  try{
    const p=await getPool();
    let r = await p.request().query(`SELECT TOP 500 RTRIM(CVE_PRO) as cve, RTRIM(DES_PRO) as nombre, ISNULL(PRE_VTA1, ISNULL(PRE_PRO,0)) as precio FROM dbo.CRART WHERE LTRIM(RTRIM(ESTATUS))='ALTA' ORDER BY DES_PRO`);
    if(r.recordset.length===0){
      r = await p.request().query(`SELECT TOP 500 RTRIM(CVE_PRO) as cve, RTRIM(DES_PRO) as nombre, ISNULL(PRE_VTA1, ISNULL(PRE_PRO,0)) as precio FROM dbo.CRART WHERE ESTATUS LIKE '%ALTA%' ORDER BY DES_PRO`);
    }
    if(r.recordset.length===0){
      r = await p.request().query(`SELECT TOP 500 RTRIM(CVE_PRO) as cve, RTRIM(DES_PRO) as nombre, ISNULL(PRE_VTA1, ISNULL(PRE_PRO,0)) as precio FROM dbo.CRART ORDER BY DES_PRO`);
    }
    res.json(r.recordset);
  }catch(e){
    console.error('Productos error:', e.message);
    res.json([]); // nunca 500
  }
});

app.get('/api/test', async(req,res)=>{ try{ const p=await getPool(); res.json({ok:true}); }catch(e){ res.status(500).json({ok:false, error:e.message}); }});

async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool();
    const cfgQ=await p.request().query(`SELECT * FROM dbo.CFG_TIENDA_WEB WHERE ID=1`);
    const cfg=cfgQ.recordset[0];
    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre=(d.nombre||'CLIENTE WEB').slice(0,100);
    const direccion=(d.direccion||'').slice(0,200);
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre).input('dir', sql.VarChar(200), direccion).input('tel', sql.VarChar(30), (d.telefono||'').slice(0,30)).query(`IF NOT EXISTS(SELECT 1 FROM dbo.C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO dbo.C_CLIENTE (CVE_CTE,DES_CTE,DIR_CTE,TEL_CTE,TIPO_CTE,FEC_ALTA) VALUES (@cve,@des,@dir,@tel,'WEB',GETDATE())`);
    const colsQ = await p.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TH_PEDIDO'`);
    const cols = colsQ.recordset.map(r=>r.COLUMN_NAME);
    const plantQ = await p.request().query(`SELECT TOP 1 * FROM dbo.TH_PEDIDO WHERE ID_SUCURSAL=${cfg.ID_SUCURSAL} ORDER BY NUM_PED DESC`);
    if(!plantQ.recordset[0]) throw new Error('Crea 1 pedido manual en SYSPTV');
    const tpl=plantQ.recordset[0];
    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM dbo.TH_PEDIDO WHERE ID_SUCURSAL=${cfg.ID_SUCURSAL} AND ID_EMP='${cfg.ID_EMP.trim()}' AND TIPO_PED='${cfg.TIPO_PED.trim()}'`);
    const folio=fr.recordset[0].folio;
    const tot=parseFloat(d.total||0);
    let insertCols=['ID_SUCURSAL','ID_EMP','TIPO_PED','NUM_PED','FEC_PED','CVE_CTE','STA_PED'];
    if(cols.includes('CVE_TAL')) insertCols.push('CVE_TAL');
    if(cols.includes('CVE_CTE_CONS')) insertCols.push('CVE_CTE_CONS');
    if(cols.includes('CVE_VEN')) insertCols.push('CVE_VEN');
    if(cols.includes('CVE_TIP_MDA')) insertCols.push('CVE_TIP_MDA');
    if(cols.includes('CVE_ATN')) insertCols.push('CVE_ATN');
    if(cols.includes('SUB_TOT')) insertCols.push('SUB_TOT');
    if(cols.includes('IVA_TOT')) insertCols.push('IVA_TOT');
    if(cols.includes('TOT_PED')) insertCols.push('TOT_PED');
    if(cols.includes('OBS_PED')) insertCols.push('OBS_PED');
    if(cols.includes('NUM_ALM')) insertCols.push('NUM_ALM');
    if(cols.includes('FEC_ENT')) insertCols.push('FEC_ENT');
    const req2=p.request(); req2.input('suc', sql.SmallInt, cfg.ID_SUCURSAL); req2.input('emp', sql.Char(10), cfg.ID_EMP.trim()); req2.input('tipo', sql.Char(10), cfg.TIPO_PED.trim()); req2.input('folio', sql.BigInt, folio); req2.input('cve', sql.VarChar(20), tel); req2.input('tot', sql.Decimal(18,2), tot); req2.input('obs', sql.VarChar(100), `${nombre} ${direccion}`.slice(0,100).replace(/'/g,'')); let values=[]; for(let c of insertCols){ switch(c){ case 'ID_SUCURSAL':values.push('@suc');break; case 'ID_EMP':values.push('@emp');break; case 'TIPO_PED':values.push('@tipo');break; case 'NUM_PED':values.push('@folio');break; case 'FEC_PED':values.push('GETDATE()');break; case 'CVE_CTE':values.push('@cve');break; case 'CVE_CTE_CONS':values.push('@cve');break; case 'STA_PED':values.push("'P'");break; case 'SUB_TOT':values.push('@tot');break; case 'TOT_PED':values.push('@tot');break; case 'IVA_TOT':values.push('0');break; case 'OBS_PED':values.push('@obs');break; case 'FEC_ENT':values.push('DATEADD(day,1,GETDATE())');break; default: const v=tpl[c]; if(v==null) values.push('NULL'); else if(typeof v==='number') values.push(v); else values.push(`'${String(v).trim().replace(/'/g,'')}'`); break; }} await req2.query(`INSERT INTO dbo.TH_PEDIDO (${insertCols.join(',')}) VALUES (${values.join(',')})`); let par=1; for(const prod of d.productos||[]){ await p.request().input('suc', sql.SmallInt, cfg.ID_SUCURSAL).input('emp', sql.Char(10), cfg.ID_EMP.trim()).input('folio', sql.BigInt, folio).input('par', sql.Int, par++).input('cve', sql.Char(20), (prod.cve||'ART').toString().slice(0,20)).input('can', sql.Decimal(18,3), parseFloat(prod.cantidad||1)).input('pre', sql.Decimal(18,2), parseFloat(prod.precio||0)).query(`INSERT INTO dbo.TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,NUM_PAR,CVE_PRO,CAN_PRO,PRE_PRO,CAN_AUT) VALUES (@suc,@emp,@folio,@par,@cve,@can,@pre,@can)`);} res.json({ok:true, folio, wa:cfg.WHATSAPP_REPARTO}); }catch(e){ console.error(e); res.status(500).json({ok:false, error:e.message}); }
}
app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.post('/api/pedido', guardarPedido);
app.get('*', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT, ()=> console.log('TIENDA WEB V3 ANTI-CAIDA en '+PORT));

// Para que nunca se caiga el proceso
process.on('uncaughtException', (e)=> console.error('Uncaught:', e.message));
process.on('unhandledRejection', (e)=> console.error('Unhandled:', e.message));
