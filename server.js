require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'SysPtv-17072026-Secret-Key-Cambia-Esto';
const PORT = process.env.PORT || 3000;

app.use(cors({origin:true, credentials:true}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const sqlConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASS || '',
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME || 'tiendaMaster',
  port: parseInt(process.env.DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true }
};

let pool=null;
async function getPool(){ if(pool&&pool.connected) return pool; if(pool) try{await pool.close()}catch{} pool=await sql.connect(sqlConfig); return pool; }

async function initDB(){
  const p=await getPool();
  await p.request().query(`IF OBJECT_ID('CFG_TIENDA_WEB') IS NULL CREATE TABLE CFG_TIENDA_WEB (ID INT PRIMARY KEY, ID_SUCURSAL SMALLINT, ID_EMP VARCHAR(20), CVE_TAL VARCHAR(10), NUM_ALM VARCHAR(10), CVE_VEN VARCHAR(10), TIPO_PED VARCHAR(10), WHATSAPP_REPARTO VARCHAR(20), NOMBRE_TIENDA VARCHAR(100))`);
  await p.request().query(`IF NOT EXISTS(SELECT 1 FROM CFG_TIENDA_WEB WHERE ID=1) INSERT INTO CFG_TIENDA_WEB (ID,ID_SUCURSAL,ID_EMP,CVE_TAL,NUM_ALM,CVE_VEN,TIPO_PED) VALUES (1,1,'17072026','01','01','01','WEB')`);

  await p.request().query(`IF OBJECT_ID('WEB_ADMIN') IS NULL CREATE TABLE WEB_ADMIN (ID INT IDENTITY PRIMARY KEY, USUARIO VARCHAR(50) UNIQUE, PASS_HASH VARCHAR(200), F_ALTA DATETIME DEFAULT GETDATE())`);
  await p.request().query(`IF OBJECT_ID('CLIENTES_WEB') IS NULL CREATE TABLE CLIENTES_WEB (ID INT IDENTITY PRIMARY KEY, TELEFONO VARCHAR(20) UNIQUE, NOMBRE VARCHAR(100), PASS_HASH VARCHAR(200), DIRECCION VARCHAR(200), F_REG DATETIME DEFAULT GETDATE())`);

  // crea admin por defecto si no existe: admin / Admin2026!
  const chk = await p.request().query(`SELECT 1 FROM WEB_ADMIN WHERE USUARIO='admin'`);
  if(chk.recordset.length===0){
    const hash = await bcrypt.hash('Admin2026!', 10);
    await p.request().input('h', sql.VarChar(200), hash).query(`INSERT INTO WEB_ADMIN (USUARIO,PASS_HASH) VALUES ('admin',@h)`);
    console.log('ADMIN CREADO: admin / Admin2026!');
  }
}
initDB();

async function getConfigDB(){
  const p=await getPool();
  const r=await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`);
  return r.recordset[0]||{ID_SUCURSAL:1, ID_EMP:'17072026', CVE_TAL:'01', NUM_ALM:'01', CVE_VEN:'01'};
}

// ===== MIDDLEWARE ADMIN =====
function authAdmin(req,res,next){
  const token = req.cookies?.admin_token;
  if(!token) return res.status(401).json({error:'No autorizado'});
  try{
    const dec = jwt.verify(token, JWT_SECRET);
    req.admin = dec;
    next();
  }catch{ return res.status(401).json({error:'Sesion expirada'}); }
}

// ===== AUTH ADMIN =====
app.post('/api/admin/login', async(req,res)=>{
  try{
    const {usuario, password} = req.body;
    const p=await getPool();
    const r=await p.request().input('u', sql.VarChar(50), usuario).query(`SELECT * FROM WEB_ADMIN WHERE USUARIO=@u`);
    if(r.recordset.length===0) return res.status(401).json({error:'Usuario no existe'});
    const ok = await bcrypt.compare(password, r.recordset[0].PASS_HASH);
    if(!ok) return res.status(401).json({error:'Pass incorrecto'});
    const token = jwt.sign({id:r.recordset[0].ID, usuario}, JWT_SECRET, {expiresIn:'12h'});
    res.cookie('admin_token', token, {httpOnly:true, secure:false, sameSite:'lax', maxAge:12*3600*1000});
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/admin/logout', (req,res)=>{ res.clearCookie('admin_token'); res.json({ok:true}); });
app.get('/api/admin/me', authAdmin, (req,res)=>{ res.json({ok:true, admin:req.admin}); });

// ===== AUTH CLIENTES =====
app.post('/api/clientes/registro', async(req,res)=>{
  try{
    const {telefono, nombre, password, direccion} = req.body;
    if(!telefono||!password||!nombre) return res.status(400).json({error:'Faltan datos'});
    const tel = telefono.toString().replace(/\D/g,'').slice(-10);
    const hash = await bcrypt.hash(password, 10);
    const p=await getPool();
    await p.request().input('t', sql.VarChar(20), tel).input('n', sql.VarChar(100), nombre.replace(/'/g,'')).input('h', sql.VarChar(200), hash).input('d', sql.VarChar(200), direccion||'')
     .query(`IF NOT EXISTS(SELECT 1 FROM CLIENTES_WEB WHERE TELEFONO=@t) INSERT INTO CLIENTES_WEB (TELEFONO,NOMBRE,PASS_HASH,DIRECCION) VALUES (@t,@n,@h,@d) ELSE UPDATE CLIENTES_WEB SET NOMBRE=@n, PASS_HASH=@h, DIRECCION=@d WHERE TELEFONO=@t`);
    // tambien crea en C_CLIENTE para SysPtv
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre.replace(/'/g,'')).query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE) VALUES (@cve,@des)`);
    const token = jwt.sign({telefono:tel, nombre}, JWT_SECRET, {expiresIn:'30d'});
    res.cookie('cliente_token', token, {httpOnly:true, secure:false, sameSite:'lax', maxAge:30*24*3600*1000});
    res.json({ok:true});
  }catch(e){ if(e.message.includes('UNIQUE')) return res.status(400).json({error:'Telefono ya registrado'}); res.status(500).json({error:e.message}); }
});

app.post('/api/clientes/login', async(req,res)=>{
  try{
    const {telefono, password} = req.body;
    const tel = telefono.toString().replace(/\D/g,'').slice(-10);
    const p=await getPool();
    const r=await p.request().input('t', sql.VarChar(20), tel).query(`SELECT * FROM CLIENTES_WEB WHERE TELEFONO=@t`);
    if(r.recordset.length===0) return res.status(401).json({error:'No registrado'});
    const ok = await bcrypt.compare(password, r.recordset[0].PASS_HASH);
    if(!ok) return res.status(401).json({error:'Pass incorrecto'});
    const token = jwt.sign({telefono:tel, nombre:r.recordset[0].NOMBRE}, JWT_SECRET, {expiresIn:'30d'});
    res.cookie('cliente_token', token, {httpOnly:true, secure:false, sameSite:'lax', maxAge:30*24*3600*1000});
    res.json({ok:true, nombre:r.recordset[0].NOMBRE});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ===== APIS PROTEGIDAS ADMIN =====
app.get('/api/config', authAdmin, async(req,res)=>{ res.json(await getConfigDB()); });
app.post('/api/config', authAdmin, async(req,res)=>{
  try{
    const c=req.body; const p=await getPool();
    await p.request().input('suc', sql.SmallInt, c.ID_SUCURSAL).input('emp', sql.VarChar(20), c.ID_EMP).input('tal', sql.VarChar(10), c.CVE_TAL).input('alm', sql.VarChar(10), c.NUM_ALM).input('ven', sql.VarChar(10), c.CVE_VEN).query(`UPDATE CFG_TIENDA_WEB SET ID_SUCURSAL=@suc, ID_EMP=@emp, CVE_TAL=@tal, NUM_ALM=@alm, CVE_VEN=@ven WHERE ID=1`);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ===== PRODUCTOS (publico para tienda, admin para gestion) =====
app.get('/api/productos', async(req,res)=>{
  try{
    const p=await getPool();
    const r=await p.request().query(`SELECT TOP 500 RTRIM(LTRIM(Articulo)) as cve, RTRIM(LTRIM(nombre)) as nombre, ISNULL(CAST(Precio as decimal(18,2)),0) as precio, ISNULL(CAST(Existencias1 as decimal(18,2)),0) as existencia FROM dbo.CRART WHERE LTRIM(RTRIM(nombre))<>'' AND LTRIM(RTRIM(Articulo))<>'' AND ISNULL(Existencias1,0) > 0 ORDER BY Articulo`);
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error:e.message}); }
});

// ===== UPLOAD PROTEGIDO =====
const imgDir = path.join(__dirname,'public','img');
if(!fs.existsSync(imgDir)) fs.mkdirSync(imgDir,{recursive:true});
const upload = multer({storage: multer.diskStorage({
  destination:(req,file,cb)=>cb(null,imgDir),
  filename:(req,file,cb)=>{ const cve=(req.body.cve||'PROD').replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase(); cb(null,cve+path.extname(file.originalname)||'.jpg'); }
})});
app.post('/api/upload-imagen', authAdmin, upload.single('imagen'), (req,res)=>{ res.json({ok:true, file:`/img/${req.file.filename}`}); });

// ===== PEDIDOS (FIX V23 del,,) =====
async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool(); const cfg=await getConfigDB();
    const SUC=parseInt(cfg.ID_SUCURSAL)||1; const EMP=String(cfg.ID_EMP).trim()||'17072026';
    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre=(d.nombre||'CLIENTE WEB').replace(/'/g,"").slice(0,100);
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre).query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE) VALUES (@cve,@des)`);
    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM TH_PEDIDO WHERE ID_SUCURSAL=${SUC} AND ID_EMP='${EMP}'`);
    const folio=fr.recordset[0].folio; const tot=parseFloat(d.total||0); const sub=tot/1.16; const iva=tot-sub;
    await p.request().input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP).input('folio', sql.Int, folio).input('cte', sql.VarChar(20), tel).input('fec', sql.DateTime, new Date()).input('fec2', sql.DateTime, new Date(Date.now()+86400000)).input('ven', sql.VarChar(10), '01').input('ivaPorc', sql.Decimal(18,2), 16).input('tipMda', sql.VarChar(10), '01').input('valMda', sql.Decimal(18,2), 1).input('sub', sql.Decimal(18,2), sub).input('ivaTot', sql.Decimal(18,2), iva)
     .query(`INSERT INTO TH_PEDIDO (ID_SUCURSAL, ID_EMP, NUM_PED, CVE_CTE, FEC_PED, FEC_ENT, IVA, CVE_VEN, CVE_TIP_MDA, VAL_TIP_MDA, SUB_TOT, IVA_TOT, TIPO_PED, STA_PED) VALUES (@suc,@emp,@folio,@cte,@fec,@fec2,@ivaPorc,@ven,@tipMda,@valMda,@sub,@ivaTot,'WEB','P')`);
    let par=1;
    for(const prod of d.productos||[]){
      let cveLimpio=(prod.cve||'').toString().replace(/'/g,'').replace(/\s+/g,'').replace(/[^a-zA-Z0-9_-]/g,'').trim().substring(0,20); if(!cveLimpio) continue;
      const cant=parseFloat(prod.cantidad||1); const prec=parseFloat(prod.precio||0);
      await p.request().input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP).input('ped', sql.Int, folio).input('can', sql.Decimal(18,3), cant).input('cve', sql.VarChar(20), cveLimpio).input('pre', sql.Decimal(18,2), prec).input('par', sql.Int, par).input('aut', sql.Decimal(18,3), cant).input('preL', sql.Decimal(18,2), prec)
       .query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,CAN_PRO,CVE_PRO,PRE_PRO,DESC_CTE,DESC_FIN,OBS_PRO,NUM_PAR,CAN_AUT,pre_desc_lista,pre_lista,iva,TIPO,PRE_SOL) VALUES (@suc,@emp,@ped,@can,@cve,@pre,0,0,'',@par,@aut,@preL,@preL,16,'P',@pre)`); par++;
    }
    res.json({ok:true, folio, empresa:EMP});
  }catch(e){ console.error(e); res.status(500).json({ok:false, error:e.message}); }
}
app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.post('/api/pedido', guardarPedido);

// sirve admin
app.get('/admin/*', (req,res,next)=>{
  if(req.path.includes('login')) return next();
  const token = req.cookies?.admin_token;
  if(!token){ return res.redirect('/admin/login.html'); }
  try{ jwt.verify(token, JWT_SECRET); next(); }catch{ return res.redirect('/admin/login.html'); }
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, ()=>console.log('V24 CON LOGIN ADMIN + CLIENTES OK en '+PORT));
