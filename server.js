require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sqlConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASS || '',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'tiendaMaster',
  port: parseInt(process.env.DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let pool=null;
async function getPool(){
  if(pool && pool.connected) return pool;
  if(pool) try{await pool.close()}catch{}
  pool=await sql.connect(sqlConfig);
  return pool;
}
async function getConfigDB(){
  try{
    const p=await getPool();
    await p.request().query(`IF OBJECT_ID('CFG_TIENDA_WEB') IS NULL CREATE TABLE CFG_TIENDA_WEB (ID INT PRIMARY KEY, ID_SUCURSAL SMALLINT, ID_EMP VARCHAR(20), NOMBRE_TIENDA VARCHAR(100), WHATSAPP_REPARTO VARCHAR(20))`);
    await p.request().query(`IF NOT EXISTS(SELECT 1 FROM CFG_TIENDA_WEB WHERE ID=1) INSERT INTO CFG_TIENDA_WEB VALUES (1,1,'17072026','TIENDA WEB - SYSPTV','')`);
    const r=await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`);
    return r.recordset[0];
  }catch{ return {ID_SUCURSAL:1, ID_EMP:'17072026', NOMBRE_TIENDA:'TIENDA WEB - SYSPTV'}; }
}

async function ensureTables(){
  try{
    const p=await getPool();
    await p.request().query(`IF COL_LENGTH('TH_PEDIDO','LAT') IS NULL ALTER TABLE TH_PEDIDO ADD LAT VARCHAR(20) NULL`);
    await p.request().query(`IF COL_LENGTH('TH_PEDIDO','LNG') IS NULL ALTER TABLE TH_PEDIDO ADD LNG VARCHAR(20) NULL`);
    await p.request().query(`IF COL_LENGTH('C_CLIENTE','PASSWORD') IS NULL ALTER TABLE C_CLIENTE ADD PASSWORD VARCHAR(100) NULL; IF COL_LENGTH('C_CLIENTE','DIRECCION') IS NULL ALTER TABLE C_CLIENTE ADD DIRECCION VARCHAR(200) NULL; IF COL_LENGTH('C_CLIENTE','LAT') IS NULL ALTER TABLE C_CLIENTE ADD LAT VARCHAR(20) NULL; IF COL_LENGTH('C_CLIENTE','LNG') IS NULL ALTER TABLE C_CLIENTE ADD LNG VARCHAR(20) NULL;`);
    await p.request().query(`IF OBJECT_ID('WEB_BANNERS') IS NULL CREATE TABLE WEB_BANNERS (ID INT IDENTITY(1,1) PRIMARY KEY, TITULO VARCHAR(100), IMAGEN VARCHAR(200), ACTIVO BIT DEFAULT 1, FECHA DATETIME DEFAULT GETDATE())`);
  }catch(e){ console.log('ensureTables', e.message) }
}
ensureTables();

app.get('/api/config', async(req,res)=>res.json(await getConfigDB()));
app.post('/api/admin/config', async(req,res)=>{
  try{
    const p=await getPool(); const c=req.body;
    await p.request().input('suc', sql.SmallInt, c.ID_SUCURSAL).input('emp', sql.VarChar(20), c.ID_EMP).input('nom', sql.VarChar(100), c.NOMBRE_TIENDA).query(`UPDATE CFG_TIENDA_WEB SET ID_SUCURSAL=@suc, ID_EMP=@emp, NOMBRE_TIENDA=@nom WHERE ID=1`);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.get('/api/productos', async(req,res)=>{
  try{
    const p=await getPool();
    const r=await p.request().query(`SELECT TOP 500 RTRIM(LTRIM(Articulo)) as cve, RTRIM(LTRIM(nombre)) as nombre, CAST(ISNULL(Precio,0) as decimal(18,2)) as precio, 10 as existencia FROM CRART WHERE LTRIM(RTRIM(Articulo))<>'' AND LTRIM(RTRIM(ISNULL(nombre,'')))<>'' AND ISNULL(Precio,0)>0 AND nombre NOT LIKE '%null%' ORDER BY nombre`);
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error:e.message}) }
});

// BANNERS PUBLICO
app.get('/api/banners', async(req,res)=>{
  try{ const p=await getPool(); const r=await p.request().query(`SELECT TOP 5 * FROM WEB_BANNERS WHERE ACTIVO=1 ORDER BY ID DESC`); res.json(r.recordset); }catch(e){ res.json([]) }
});
app.get('/api/admin/banners', async(req,res)=>{
  try{ const p=await getPool(); const r=await p.request().query(`SELECT * FROM WEB_BANNERS ORDER BY ID DESC`); res.json(r.recordset); }catch(e){ res.status(500).json({error:e.message}) }
});
app.post('/api/admin/banners', async(req,res)=>{
  try{ const p=await getPool(); await p.request().input('tit', sql.VarChar(100), req.body.titulo||'').input('img', sql.VarChar(200), req.body.imagen||'').query(`INSERT INTO WEB_BANNERS (TITULO, IMAGEN, ACTIVO) VALUES (@tit, @img, 1)`); res.json({ok:true}); }catch(e){ res.status(500).json({error:e.message}) }
});
app.delete('/api/admin/banners/:id', async(req,res)=>{
  try{ const p=await getPool(); await p.request().query(`DELETE FROM WEB_BANNERS WHERE ID=${parseInt(req.params.id)}`); res.json({ok:true}); }catch(e){ res.status(500).json({error:e.message}) }
});

app.post('/api/cliente/registro', async(req,res)=>{
  try{
    const p=await getPool();
    const {nombre, telefono, password, direccion}=req.body;
    const tel=telefono.replace(/\D/g,'').slice(-10);
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre).input('pass', sql.VarChar(100), password).input('dir', sql.VarChar(200), direccion)
.query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE,PASSWORD,DIRECCION) VALUES (@cve,@des,@pass,@dir) ELSE UPDATE C_CLIENTE SET DES_CTE=@des, PASSWORD=@pass, DIRECCION=@dir WHERE CVE_CTE=@cve`);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.post('/api/cliente/login', async(req,res)=>{
  try{
    const tel = (req.body.telefono||'').toString().trim();
    const pass = (req.body.password||'').toString().trim();
    if(tel.toLowerCase()==='admin' && pass==='Admin2026!'){
      return res.json({ok:true, esAdmin:true, cliente:{CVE_CTE:'ADMIN', DES_CTE:'ADMINISTRADOR', DIRECCION:'ADMIN'}});
    }
    const p=await getPool();
    const r=await p.request().input('cve', sql.VarChar(20), tel).query(`SELECT * FROM C_CLIENTE WHERE CVE_CTE=@cve`);
    if(r.recordset.length===0) return res.status(404).json({error:'No existe, regístrate'});
    if(r.recordset[0].PASSWORD && r.recordset[0].PASSWORD!==pass) return res.status(401).json({error:'Contraseña incorrecta'});
    res.json({ok:true, cliente:r.recordset[0]});
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.get('/api/admin/pedidos', async(req,res)=>{
  try{
    const p=await getPool(); const cfg=await getConfigDB();
    const r=await p.request().query(`SELECT TOP 100 th.NUM_PED, th.FEC_PED, th.SUB_TOT, th.IVA_TOT, th.LAT as PED_LAT, th.LNG as PED_LNG, c.DES_CTE, c.CVE_CTE, c.DIRECCION, c.LAT, c.LNG FROM TH_PEDIDO th LEFT JOIN C_CLIENTE c ON th.CVE_CTE=c.CVE_CTE WHERE th.ID_SUCURSAL=${cfg.ID_SUCURSAL} AND th.ID_EMP='${cfg.ID_EMP}' ORDER BY th.NUM_PED DESC`);
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.get('/api/admin/clientes', async(req,res)=>{
  try{ const p=await getPool(); const r=await p.request().query(`SELECT TOP 100 * FROM C_CLIENTE ORDER BY CVE_CTE DESC`); res.json(r.recordset); }catch(e){ res.status(500).json({error:e.message}) }
});

app.post('/api/admin/login', (req,res)=>{ if(req.body.user==='admin' && req.body.pass==='Admin2026!') res.json({ok:true}); else res.status(401).json({error:'No'}); });

app.get('/api/admin/pedido/:folio', async(req,res)=>{
  try{
    const p=await getPool(); const cfg=await getConfigDB();
    const folio=parseInt(req.params.folio);
    const h=await p.request().query(`SELECT th.NUM_PED, th.FEC_PED, th.SUB_TOT, th.IVA_TOT, th.LAT as PED_LAT, th.LNG as PED_LNG, th.CVE_CTE, c.DES_CTE, c.DIRECCION, c.LAT, c.LNG FROM TH_PEDIDO th LEFT JOIN C_CLIENTE c ON th.CVE_CTE=c.CVE_CTE WHERE th.NUM_PED=${folio} AND th.ID_SUCURSAL=${cfg.ID_SUCURSAL} AND th.ID_EMP='${cfg.ID_EMP}'`);
    const d=await p.request().query(`SELECT td.CAN_PRO, td.CVE_PRO, td.PRE_PRO, ISNULL(RTRIM(LTRIM(cr.nombre)),'') as nombre FROM TD_PEDIDO td LEFT JOIN CRART cr ON LTRIM(RTRIM(cr.Articulo))=LTRIM(RTRIM(td.CVE_PRO)) WHERE td.NUM_PED=${folio} AND td.ID_SUCURSAL=${cfg.ID_SUCURSAL} AND td.ID_EMP='${cfg.ID_EMP}' ORDER BY td.NUM_PAR`);
    res.json({header:h.recordset[0]||null, detail:d.recordset});
  }catch(e){ res.status(500).json({error:e.message}) }
});

const imgDir = path.join(__dirname,'public','img'); if(!fs.existsSync(imgDir)) fs.mkdirSync(imgDir,{recursive:true});
const bannersDir = path.join(__dirname,'public','banners'); if(!fs.existsSync(bannersDir)) fs.mkdirSync(bannersDir,{recursive:true});
const upload = multer({storage: multer.diskStorage({ destination:(req,file,cb)=>{ const dest = req.body.tipo==='banner'? bannersDir : imgDir; cb(null,dest); }, filename:(req,file,cb)=>{ if(req.body.tipo==='banner'){ cb(null, 'banner_'+Date.now()+'.jpg'); } else { const cve=(req.body.cve||'PROD').replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase(); cb(null,cve+'.jpg'); } } })});
app.post('/api/upload-imagen', upload.single('imagen'), (req,res)=>{
  if(req.body.tipo==='banner') res.json({ok:true, file:`/banners/${req.file.filename}`});
  else res.json({ok:true, file:`/img/${req.file.filename}`});
});

async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool(); const cfg=await getConfigDB();
    const SUC=parseInt(cfg.ID_SUCURSAL)||1; const EMP=String(cfg.ID_EMP).trim()||'17072026';
    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre=(d.nombre||'CLIENTE WEB').replace(/'/g,"").slice(0,100);
    const direccion=(d.direccion||'').slice(0,200); const lat=d.lat||null; const lng=d.lng||null;
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre).input('dir', sql.VarChar(200), direccion).input('lat', sql.VarChar(20), lat).input('lng', sql.VarChar(20), lng)
.query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE,DIRECCION,LAT,LNG) VALUES (@cve,@des,@dir,@lat,@lng) ELSE UPDATE C_CLIENTE SET DIRECCION=@dir, LAT=@lat, LNG=@lng WHERE CVE_CTE=@cve`);
    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM TH_PEDIDO WHERE ID_SUCURSAL=${SUC} AND ID_EMP='${EMP}'`);
    const folio=fr.recordset[0].folio;
    let totalReal=0; let productosReales=[];
    for(const prod of d.productos||[]){
      let cveLimpio=(prod.cve||prod.articulo||'').toString().trim().substring(0,20);
      const rPrecio=await p.request().input('cve', sql.VarChar(20), cveLimpio).query(`SELECT CAST(Precio as decimal(18,2)) as precio FROM CRART WHERE LTRIM(RTRIM(Articulo))=@cve`);
      let precioReal = rPrecio.recordset[0]?.precio || prod.precio || 0;
      productosReales.push({cve:cveLimpio, cant: prod.cantidad, precio: precioReal}); totalReal+=precioReal*prod.cantidad;
    }
    const sub=totalReal/1.16; const iva=totalReal-sub;
    await p.request().input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP).input('folio', sql.Int, folio).input('cte', sql.VarChar(20), tel).input('fec', sql.DateTime, new Date()).input('fec2', sql.DateTime, new Date(Date.now()+86400000)).input('ven', sql.VarChar(10), '01').input('ivaPorc', sql.Decimal(18,2), 16).input('tipMda', sql.VarChar(10), '01').input('valMda', sql.Decimal(18,2), 1).input('sub', sql.Decimal(18,2), sub).input('ivaTot', sql.Decimal(18,2), iva).input('lat', sql.VarChar(20), lat).input('lng', sql.VarChar(20), lng)
.query(`INSERT INTO TH_PEDIDO (ID_SUCURSAL, ID_EMP, NUM_PED, CVE_CTE, FEC_PED, FEC_ENT, IVA, CVE_VEN, CVE_TIP_MDA, VAL_TIP_MDA, SUB_TOT, IVA_TOT, TIPO_PED, STA_PED, LAT, LNG) VALUES (@suc,@emp,@folio,@cte,@fec,@fec2,@ivaPorc,@ven,@tipMda,@valMda,@sub,@ivaTot,'WEB','P',@lat,@lng)`);
    let par=1;
    for(const pr of productosReales){
      await p.request().input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP).input('ped', sql.Int, folio).input('can', sql.Decimal(18,3), pr.cant).input('cve', sql.VarChar(20), pr.cve).input('pre', sql.Decimal(18,2), pr.precio).input('par', sql.Int, par).input('aut', sql.Decimal(18,3), pr.cant).input('preL', sql.Decimal(18,2), pr.precio)
.query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,CAN_PRO,CVE_PRO,PRE_PRO,DESC_CTE,DESC_FIN,OBS_PRO,NUM_PAR,CAN_AUT,pre_desc_lista,pre_lista,iva,TIPO,PRE_SOL) VALUES (@suc,@emp,@ped,@can,@cve,@pre,0,0,'',@par,@aut,@preL,@preL,16,'P',@pre)`); par++;
    }
    res.json({ok:true, folio, total: totalReal});
  }catch(e){ console.error(e); res.status(500).json({ok:false, error:e.message}); }
}
app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.get('/api/health', (req,res)=>res.json({ok:true}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT, ()=>console.log('V34 BANNERS+GPS_PED en '+PORT));
