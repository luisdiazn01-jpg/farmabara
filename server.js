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
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME || 'tiendaMaster',
  port: parseInt(process.env.DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true }
};

let pool=null;
async function getPool(){ if(pool&&pool.connected) return pool; if(pool) try{await pool.close()}catch{} pool=await sql.connect(sqlConfig); return pool; }

async function getConfigDB(){
  try{
    const p=await getPool();
    await p.request().query(`IF OBJECT_ID('CFG_TIENDA_WEB') IS NULL CREATE TABLE CFG_TIENDA_WEB (ID INT PRIMARY KEY, ID_SUCURSAL SMALLINT, ID_EMP VARCHAR(20), CVE_TAL VARCHAR(10), NUM_ALM VARCHAR(10), CVE_VEN VARCHAR(10), TIPO_PED VARCHAR(10), WHATSAPP_REPARTO VARCHAR(20), NOMBRE_TIENDA VARCHAR(100))`);
    await p.request().query(`IF NOT EXISTS(SELECT 1 FROM CFG_TIENDA_WEB WHERE ID=1) INSERT INTO CFG_TIENDA_WEB (ID,ID_SUCURSAL,ID_EMP,CVE_TAL,NUM_ALM,CVE_VEN,TIPO_PED) VALUES (1,1,'17072026','01','01','01','WEB')`);
    const r=await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`);
    return r.recordset[0]||{ID_SUCURSAL:1, ID_EMP:'17072026', CVE_TAL:'01', NUM_ALM:'01', CVE_VEN:'01', NOMBRE_TIENDA:'TIENDA WEB - SYSPTV'};
  }catch{ return {ID_SUCURSAL:1, ID_EMP:'17072026', CVE_TAL:'01', NUM_ALM:'01', CVE_VEN:'01', NOMBRE_TIENDA:'TIENDA WEB - SYSPTV'}; }
}

app.get('/api/config', async(req,res)=>{ const cfg=await getConfigDB(); res.json(cfg); });

app.get('/api/productos', async(req,res)=>{
  try{
    const p=await getPool();
    const r=await p.request().query(`
      SELECT TOP 500
        RTRIM(LTRIM(Articulo)) as cve,
        RTRIM(LTRIM(nombre)) as nombre,
        ISNULL(CAST(Precio as decimal(18,2)),0) as precio,
        ISNULL(CAST(Existencias1 as decimal(18,2)),0) as existencia
      FROM dbo.CRART
      WHERE LTRIM(RTRIM(nombre))<>''
        AND LTRIM(RTRIM(Articulo))<>''
        AND ISNULL(Existencias1,0) > 0
      ORDER BY Articulo
    `);
    res.json(r.recordset);
  }catch(e){ console.error('PRODUCTOS ERROR:', e.message); res.status(500).json({error:e.message}); }
});

// --- NUEVO PARA EL ADMIN BONITO, NO TOCA TUS PEDIDOS ---
app.get('/api/admin/pedidos', async(req,res)=>{
  try{
    const p=await getPool(); const cfg=await getConfigDB();
    const r=await p.request().query(`SELECT TOP 100 * FROM TH_PEDIDO WHERE ID_SUCURSAL=${cfg.ID_SUCURSAL} AND ID_EMP='${cfg.ID_EMP}' ORDER BY NUM_PED DESC`);
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error:e.message}) }
});
app.get('/api/admin/pedido/:folio', async(req,res)=>{
  try{
    const p=await getPool(); const cfg=await getConfigDB();
    const h=await p.request().query(`SELECT * FROM TH_PEDIDO WHERE NUM_PED=${req.params.folio} AND ID_SUCURSAL=${cfg.ID_SUCURSAL}`);
    const d=await p.request().query(`SELECT * FROM TD_PEDIDO WHERE NUM_PED=${req.params.folio} AND ID_SUCURSAL=${cfg.ID_SUCURSAL}`);
    const c=await p.request().query(`SELECT * FROM C_CLIENTE WHERE CVE_CTE='${h.recordset[0]?.CVE_CTE}'`);
    res.json({header:h.recordset[0], detalle:d.recordset, cliente:c.recordset[0]});
  }catch(e){ res.status(500).json({error:e.message}) }
});
app.get('/api/admin/clientes', async(req,res)=>{
  try{ const p=await getPool(); const r=await p.request().query(`SELECT TOP 100 * FROM C_CLIENTE ORDER BY CVE_CTE DESC`); res.json(r.recordset); }catch(e){ res.status(500).json({error:e.message}) }
});

const imgDir = path.join(__dirname,'public','img');
if(!fs.existsSync(imgDir)) fs.mkdirSync(imgDir,{recursive:true});
const upload = multer({storage: multer.diskStorage({
  destination:(req,file,cb)=>cb(null,imgDir),
  filename:(req,file,cb)=>{ const cve=(req.body.cve||'PROD').replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase(); cb(null,cve+path.extname(file.originalname)||'.jpg'); }
})});
app.post('/api/upload-imagen', upload.single('imagen'), (req,res)=>{ res.json({ok:true, file:`/img/${req.file.filename}`})});

// --- TU FUNCION BUENA DE PEDIDOS, INTACTA, NO SE TOCA ---
async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool();
    const cfg=await getConfigDB();
    const SUC=parseInt(cfg.ID_SUCURSAL)||1;
    const EMP=String(cfg.ID_EMP).trim()||'17072026';
    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre=(d.nombre||'CLIENTE WEB').replace(/'/g,"").slice(0,100);
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre)
.query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE) VALUES (@cve,@des)`);

    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM TH_PEDIDO WHERE ID_SUCURSAL=${SUC} AND ID_EMP='${EMP}'`);
    const folio=fr.recordset[0].folio;
    const tot=parseFloat(d.total||0);
    const sub=tot/1.16;
    const iva=tot-sub;

    await p.request()
.input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP).input('folio', sql.Int, folio)
.input('cte', sql.VarChar(20), tel).input('fec', sql.DateTime, new Date()).input('fec2', sql.DateTime, new Date(Date.now()+86400000))
.input('ven', sql.VarChar(10), '01').input('ivaPorc', sql.Decimal(18,2), 16).input('tipMda', sql.VarChar(10), '01').input('valMda', sql.Decimal(18,2), 1)
.input('sub', sql.Decimal(18,2), sub).input('ivaTot', sql.Decimal(18,2), iva)
.query(`INSERT INTO TH_PEDIDO (ID_SUCURSAL, ID_EMP, NUM_PED, CVE_CTE, FEC_PED, FEC_ENT, IVA, CVE_VEN, CVE_TIP_MDA, VAL_TIP_MDA, SUB_TOT, IVA_TOT, TIPO_PED, STA_PED) VALUES (@suc,@emp,@folio,@cte,@fec,@fec2,@ivaPorc,@ven,@tipMda,@valMda,@sub,@ivaTot,'WEB','P')`);

    let par=1;
    for(const prod of d.productos||[]){
      let cveLimpio=(prod.cve||'').toString().replace(/'/g,'').replace(/\s+/g,'').replace(/[^a-zA-Z0-9_-]/g,'').trim().substring(0,20);
      if(!cveLimpio) continue;
      const cant=parseFloat(prod.cantidad||1);
      const prec=parseFloat(prod.precio||0);
      await p.request()
.input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP).input('ped', sql.Int, folio).input('can', sql.Decimal(18,3), cant)
.input('cve', sql.VarChar(20), cveLimpio).input('pre', sql.Decimal(18,2), prec).input('par', sql.Int, par).input('aut', sql.Decimal(18,3), cant).input('preL', sql.Decimal(18,2), prec)
.query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,CAN_PRO,CVE_PRO,PRE_PRO,DESC_CTE,DESC_FIN,OBS_PRO,NUM_PAR,CAN_AUT,pre_desc_lista,pre_lista,iva,TIPO,PRE_SOL) VALUES (@suc,@emp,@ped,@can,@cve,@pre,0,0,'',@par,@aut,@preL,@preL,16,'P',@pre)`);
      par++;
    }
    res.json({ok:true, folio, empresa:EMP});
  }catch(e){ console.error(e); res.status(500).json({ok:false, error:e.message}); }
}
app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.post('/api/pedido', guardarPedido);

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT, ()=>console.log('V24 FINAL - TU V23 BUENO + ADMIN BONITO en '+PORT));