require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/img', express.static(path.join(__dirname, 'public','img')));

const sqlConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASS || process.env.DB_PASSWORD || '',
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME || 'tiendaMaster',
  port: parseInt(process.env.DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true }
};
let pool=null;
async function getPool(){ if(pool&&pool.connected) return pool; if(pool) try{await pool.close()}catch{} pool=await sql.connect(sqlConfig); return pool; }
async function getCols(t){ const p=await getPool(); const r=await p.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}'`); return r.recordset.map(c=>c.COLUMN_NAME); }

const imgDir = path.join(__dirname,'public','img');
if(!fs.existsSync(imgDir)) fs.mkdirSync(imgDir,{recursive:true});
const storage = multer.diskStorage({
  destination:(req,file,cb)=>cb(null,imgDir),
  filename:(req,file,cb)=>{ const cve=(req.body.cve||'PROD').toString().replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase(); const ext=path.extname(file.originalname)||'.jpg'; cb(null,cve+ext); }
});
const upload = multer({storage});

app.get('/api/health',(req,res)=>res.json({ok:true}));
app.get('/api/debug-pedido', async(req,res)=>{ try{ const p=await getPool(); const th=await p.request().query(`SELECT TOP 3 * FROM TH_PEDIDO ORDER BY NUM_PED DESC`); const cols=await getCols('TH_PEDIDO'); res.json({cols, ultimos:th.recordset}); }catch(e){res.json({error:e.message})}});
app.get('/api/productos', async(req,res)=>{ try{ const p=await getPool(); const r=await p.request().query(`SELECT TOP 500 RTRIM(Articulo) as cve, RTRIM(nombre) as nombre, ISNULL(CAST([Precio] as decimal(18,2)),0) as precio FROM dbo.CRART WHERE LTRIM(RTRIM(nombre))<>'' ORDER BY Articulo`); res.json(r.recordset.map(pr=>{ const b=pr.cve.replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase(); let img=null; if(fs.existsSync(path.join(imgDir,b+'.jpg'))) img=`/img/${b}.jpg`; return {...pr, imagen:img}})); }catch(e){res.status(500).json({error:e.message})}});
app.post('/api/upload-imagen', upload.single('imagen'), (req,res)=>{ res.json({ok:true, file:`/img/${req.file.filename}`})});
app.get('/api/config', async(req,res)=>{ try{const p=await getPool(); const r=await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`); res.json(r.recordset[0]||{});}catch{res.json({})}});

// --- GUARDAR PEDIDO COMPATIBLE CON SYSPTV ---
async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool();
    const cfgQ=await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`);
    const cfg=cfgQ.recordset[0] || {ID_SUCURSAL:1, ID_EMP:'01', CVE_TAL:'01', NUM_ALM:'01', CVE_VEN:'01', TIPO_PED:'WEB'};

    const thCols = await getCols('TH_PEDIDO');
    const thU = thCols.map(c=>c.toUpperCase());

    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre=(d.nombre||'CLIENTE WEB').slice(0,100);
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre)
    .query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE) VALUES (@cve,@des)`);

    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM TH_PEDIDO WHERE ID_SUCURSAL=${cfg.ID_SUCURSAL} AND ID_EMP='${String(cfg.ID_EMP).trim()}'`);
    const folio=fr.recordset[0].folio;
    const tot=parseFloat(d.total||0);
    const subTot = tot / 1.16;
    const ivaTot = tot - subTot;

    // Armamos objeto con TODAS las columnas que SysPtv necesita, sin NULLs
    let data = {};
    if(thU.includes('ID_SUCURSAL')) data.ID_SUCURSAL = cfg.ID_SUCURSAL;
    if(thU.includes('ID_EMP')) data.ID_EMP = String(cfg.ID_EMP).trim();
    if(thU.includes('NUM_PED')) data.NUM_PED = folio;
    if(thU.includes('CVE_CTE')) data.CVE_CTE = tel;
    if(thU.includes('FEC_PED')) data.FEC_PED = new Date();
    if(thU.includes('FEC_ENT')) data.FEC_ENT = new Date(Date.now()+86400000);
    if(thU.includes('IVA')) data.IVA = 16;
    if(thU.includes('CVE_VEN')) data.CVE_VEN = String(cfg.CVE_VEN||'01').trim();
    if(thU.includes('CVE_TAL')) data.CVE_TAL = String(cfg.CVE_TAL||'01').trim();
    if(thU.includes('NUM_ALM')) data.NUM_ALM = String(cfg.NUM_ALM||'01').trim();
    if(thU.includes('CVE_TIP_MDA')) data.CVE_TIP_MDA = '01';
    if(thU.includes('VAL_TIP_MDA')) data.VAL_TIP_MDA = 1;
    if(thU.includes('SUB_TOT')) data.SUB_TOT = subTot;
    if(thU.includes('IVA_TOT')) data.IVA_TOT = ivaTot;
    if(thU.includes('TOT_PED')) data.TOT_PED = tot;
    if(thU.includes('TOTAL')) data.TOTAL = tot;
    if(thU.includes('TIPO_PED')) data.TIPO_PED = String(cfg.TIPO_PED||'WEB').trim();
    if(thU.includes('STA_PED')) data.STA_PED = 'P'; // P = Pendiente para que SysPtv lo jale
    if(thU.includes('OBS_PED')) data.OBS_PED = (d.direccion||'').slice(0,250);

    const keys = Object.keys(data);
    const colsReal = keys.map(k=> thCols.find(c=>c.toUpperCase()===k) || k);
    let q=`INSERT INTO TH_PEDIDO (${colsReal.join(',')}) VALUES (${keys.map((k,i)=>`@p${i}`).join(',')})`;
    let rq=p.request();
    keys.forEach((k,i)=>{
      const v=data[k];
      if(v instanceof Date) rq.input(`p${i}`, sql.DateTime, v);
      else if(typeof v==='number' &&!Number.isInteger(v)) rq.input(`p${i}`, sql.Decimal(18,2), v);
      else if(Number.isInteger(v)) rq.input(`p${i}`, sql.Int, v);
      else rq.input(`p${i}`, sql.VarChar(250), String(v));
    });
    console.log('INSERT TH:', q, data);
    await rq.query(q);

    // Detalle
    let par=1;
    for(const prod of d.productos||[]){
      await p.request()
      .input('suc', sql.SmallInt, cfg.ID_SUCURSAL)
      .input('emp', sql.Char(10), String(cfg.ID_EMP).trim())
      .input('folio', sql.Int, folio)
      .input('par', sql.Int, par++)
      .input('cve', sql.Char(20), (prod.cve||'ART').toString().slice(0,20))
      .input('can', sql.Decimal(18,3), parseFloat(prod.cantidad||1))
      .input('pre', sql.Decimal(18,2), parseFloat(prod.precio||0))
      .query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,NUM_PAR,CVE_PRO,CAN_PRO,PRE_PRO,CAN_AUT) VALUES (@suc,@emp,@folio,@par,@cve,@can,@pre,@can)`);
    }

    res.json({ok:true, folio, cliente:tel, nombre_cliente:nombre, empresa:String(cfg.ID_EMP).trim(), sucursal:cfg.ID_SUCURSAL, wa:cfg.WHATSAPP_REPARTO});
  }catch(e){ console.error(e); res.status(500).json({ok:false, error:e.message, detalle:e.originalError?.message}); }
}
app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.post('/api/pedido', guardarPedido);
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000, ()=>console.log('V14 SysPtv Fix'));
