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
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));

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
  return pool;
}
async function getCols(tabla) {
  const p = await getPool();
  const r = await p.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${tabla}'`);
  return r.recordset.map(c => c.COLUMN_NAME);
}

// --- CREAR CARPETA DE IMAGENES ---
const imgDir = path.join(__dirname, 'public', 'img');
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, imgDir),
  filename: (req, file, cb) => {
    const cve = (req.body.cve || req.query.cve || 'PROD').toString().replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase();
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, cve + ext);
  }
});
const upload = multer({ storage });

// --- ENDPOINTS ---

app.get('/api/health', (req,res)=> res.json({ok:true}));

app.get('/api/debug-pedido', async(req,res)=>{
  try{
    const p = await getPool();
    const th = await getCols('TH_PEDIDO');
    const td = await getCols('TD_PEDIDO');
    const cte = await getCols('C_CLIENTE');
    res.json({ TH_PEDIDO: th, TD_PEDIDO: td, C_CLIENTE: cte });
  }catch(e){ res.json({error:e.message}); }
});

app.get('/api/debug-crart', async(req,res)=>{
  try{
    const p = await getPool();
    const total = await p.request().query(`SELECT COUNT(*) as total FROM dbo.CRART`);
    const top = await p.request().query(`SELECT TOP 3 RTRIM(Articulo) as cve, RTRIM(nombre) as nombre, [Precio] as precio FROM dbo.CRART`);
    res.json({ total: total.recordset[0], top });
  }catch(e){ res.json({error:e.message}); }
});

app.get('/api/productos', async(req,res)=>{
  try{
    const p = await getPool();
    const r = await p.request().query(`SELECT TOP 500 RTRIM(Articulo) as cve, RTRIM(nombre) as nombre, ISNULL(CAST([Precio] as decimal(18,2)),0) as precio FROM dbo.CRART WHERE LTRIM(RTRIM(nombre))<>'' ORDER BY Articulo`);
    // Agregamos url de imagen si existe
    const prods = r.recordset.map(pr => {
      const base = pr.cve.replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase();
      let imgUrl = null;
      if (fs.existsSync(path.join(imgDir, base + '.jpg'))) imgUrl = `/img/${base}.jpg`;
      else if (fs.existsSync(path.join(imgDir, base + '.png'))) imgUrl = `/img/${base}.png`;
      else if (fs.existsSync(path.join(imgDir, base + '.jpeg'))) imgUrl = `/img/${base}.jpeg`;
      return {...pr, imagen: imgUrl };
    });
    res.json(prods);
  }catch(e){ res.status(500).json({error:e.message}); }
});

// SUBIR IMAGEN POR PRODUCTO - Usa: POST /api/upload-imagen con form-data cve=000... y imagen=file
app.post('/api/upload-imagen', upload.single('imagen'), (req,res)=>{
  try{
    if(!req.file) return res.status(400).json({ok:false, error:'No file'});
    res.json({ok:true, file: `/img/${req.file.filename}`, cve: req.body.cve});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.get('/api/config', async(req,res)=>{ try{ const p=await getPool(); const r=await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`); res.json(r.recordset[0]||{});}catch{res.json({})}});
app.post('/api/config', async(req,res)=>{ try{ const c=req.body; const p=await getPool(); await p.request().input('suc', sql.SmallInt, c.ID_SUCURSAL||1).input('emp', sql.Char(10), c.ID_EMP||'01').input('tal', sql.Char(10), c.CVE_TAL||'01').input('alm', sql.Char(10), c.NUM_ALM||'01').input('ven', sql.Char(10), c.CVE_VEN||'01').input('tipo', sql.Char(10), c.TIPO_PED||'WEB').input('wa', sql.VarChar(20), c.WHATSAPP_REPARTO||'').input('nom', sql.VarChar(100), c.NOMBRE_TIENDA||'').query(`UPDATE CFG_TIENDA_WEB SET ID_SUCURSAL=@suc, ID_EMP=@emp, CVE_TAL=@tal, NUM_ALM=@alm, CVE_VEN=@ven, TIPO_PED=@tipo, WHATSAPP_REPARTO=@wa, NOMBRE_TIENDA=@nom WHERE ID=1`); res.json({ok:true}); }catch(e){ res.status(500).json({error:e.message}); }});

async function guardarPedido(req,res){
  const d = req.body;
  try{
    const p = await getPool();
    const cfgQ = await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`);
    const cfg = cfgQ.recordset[0];

    const thCols = await getCols('TH_PEDIDO');
    const thColsU = thCols.map(c=>c.toUpperCase());
    const tdCols = await getCols('TD_PEDIDO');
    const tdColsU = tdCols.map(c=>c.toUpperCase());

    const tel = (d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre = (d.nombre||'CLIENTE WEB').slice(0,100);
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre)
     .query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE) VALUES (@cve,@des)`);

    const fr = await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM TH_PEDIDO WHERE ID_SUCURSAL=${cfg.ID_SUCURSAL} AND ID_EMP='${String(cfg.ID_EMP).trim()}' AND TIPO_PED='${String(cfg.TIPO_PED).trim()}'`);
    const folio = fr.recordset[0].folio;
    const tot = parseFloat(d.total||0);

    // Armar INSERT dinámico para TH_PEDIDO solo con columnas que EXISTEN
    let thData = {};
    if (thColsU.includes('ID_SUCURSAL')) thData.ID_SUCURSAL = cfg.ID_SUCURSAL;
    if (thColsU.includes('ID_EMP')) thData.ID_EMP = String(cfg.ID_EMP).trim();
    if (thColsU.includes('TIPO_PED')) thData.TIPO_PED = String(cfg.TIPO_PED).trim();
    if (thColsU.includes('NUM_PED')) thData.NUM_PED = folio;
    if (thColsU.includes('FEC_PED')) thData.FEC_PED = new Date();
    if (thColsU.includes('CVE_CTE')) thData.CVE_CTE = tel;
    if (thColsU.includes('STA_PED')) thData.STA_PED = 'P';
    // Totales - detecta cual existe
    if (thColsU.includes('TOT_PED')) thData.TOT_PED = tot;
    if (thColsU.includes('TOTAL')) thData.TOTAL = tot;
    if (thColsU.includes('TOT_PEDIDO')) thData.TOT_PEDIDO = tot;
    if (thColsU.includes('IMPORTE')) thData.IMPORTE = tot;
    if (thColsU.includes('SUB_TOT')) thData.SUB_TOT = tot;
    if (thColsU.includes('SUBTOTAL')) thData.SUBTOTAL = tot;

    const thKeys = Object.keys(thData);
    const thColsReal = thKeys.map(k => thCols.find(c=>c.toUpperCase()===k) || k);
    let q = `INSERT INTO TH_PEDIDO (${thColsReal.join(',')}) VALUES (${thKeys.map((k,i)=>`@p${i}`).join(',')})`;
    let reqTh = p.request();
    thKeys.forEach((k,i)=>{
      const v = thData[k];
      if (v instanceof Date) reqTh.input(`p${i}`, sql.DateTime, v);
      else if (typeof v === 'number' &&!Number.isInteger(v)) reqTh.input(`p${i}`, sql.Decimal(18,2), v);
      else reqTh.input(`p${i}`, sql.VarChar(100), String(v));
    });
    await reqTh.query(q);

    let par=1;
    for(const prod of d.productos||[]){
      let tdData = {};
      if (tdColsU.includes('ID_SUCURSAL')) tdData.ID_SUCURSAL = cfg.ID_SUCURSAL;
      if (tdColsU.includes('ID_EMP')) tdData.ID_EMP = String(cfg.ID_EMP).trim();
      if (tdColsU.includes('NUM_PED')) tdData.NUM_PED = folio;
      if (tdColsU.includes('NUM_PAR')) tdData.NUM_PAR = par;
      if (tdColsU.includes('CVE_PRO')) tdData.CVE_PRO = (prod.cve||'ART').toString().slice(0,20);
      if (tdColsU.includes('ARTICULO')) tdData.ARTICULO = (prod.cve||'ART').toString().slice(0,20);
      if (tdColsU.includes('CAN_PRO')) tdData.CAN_PRO = parseFloat(prod.cantidad||1);
      if (tdColsU.includes('CANTIDAD')) tdData.CANTIDAD = parseFloat(prod.cantidad||1);
      if (tdColsU.includes('PRE_PRO')) tdData.PRE_PRO = parseFloat(prod.precio||0);
      if (tdColsU.includes('PRECIO')) tdData.PRECIO = parseFloat(prod.precio||0);
      if (tdColsU.includes('CAN_AUT')) tdData.CAN_AUT = parseFloat(prod.cantidad||1);

      const tdKeys = Object.keys(tdData);
      const tdColsReal = tdKeys.map(k => tdCols.find(c=>c.toUpperCase()===k) || k);
      let q2 = `INSERT INTO TD_PEDIDO (${tdColsReal.join(',')}) VALUES (${tdKeys.map((k,i)=>`@p${i}`).join(',')})`;
      let reqTd = p.request();
      tdKeys.forEach((k,i)=>{
        const v = tdData[k];
        if (typeof v === 'number' &&!Number.isInteger(v)) reqTd.input(`p${i}`, sql.Decimal(18,3), v);
        else if (Number.isInteger(v)) reqTd.input(`p${i}`, sql.Int, v);
        else reqTd.input(`p${i}`, sql.VarChar(100), String(v));
      });
      await reqTd.query(q2);
      par++;
    }

    res.json({ ok: true, folio, wa: cfg.WHATSAPP_REPARTO });
  }catch(e){
    console.error('PEDIDO ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message, detalle: e.originalError?.message });
  }
}

app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.post('/api/pedido', guardarPedido);
app.get('*', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(process.env.PORT||3000, ()=>console.log('V13 con fix TOT_PED + imagenes'));
