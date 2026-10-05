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
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true }
};

let pool;
async function getPool(){
  if(pool?.connected) return pool;
  pool = await sql.connect(sqlConfig);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='CFG_TIENDA_WEB' AND xtype='U')
    CREATE TABLE dbo.CFG_TIENDA_WEB (
      ID INT PRIMARY KEY,
      ID_SUCURSAL SMALLINT NOT NULL DEFAULT 1,
      ID_EMP CHAR(10) NOT NULL DEFAULT '01',
      CVE_TAL CHAR(10) NOT NULL DEFAULT '01',
      NUM_ALM CHAR(10) NOT NULL DEFAULT '01',
      CVE_VEN CHAR(10) NOT NULL DEFAULT '01',
      TIPO_PED CHAR(10) NOT NULL DEFAULT 'WEB',
      WHATSAPP_REPARTO VARCHAR(20) DEFAULT '525500000000',
      NOMBRE_TIENDA VARCHAR(100) DEFAULT 'TIENDA WEB - SYSPTV'
    );
    IF NOT EXISTS (SELECT 1 FROM dbo.CFG_TIENDA_WEB WHERE ID=1)
      INSERT INTO dbo.CFG_TIENDA_WEB (ID, ID_SUCURSAL, ID_EMP, CVE_TAL, NUM_ALM, CVE_VEN) VALUES (1,1,'01','01','01','01');
  `);
  return pool;
}

app.get('/api/config', async(req,res)=>{
  try{
    const p=await getPool();
    const r=await p.request().query(`SELECT * FROM dbo.CFG_TIENDA_WEB WHERE ID=1`);
    res.json(r.recordset[0]);
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/config', async(req,res)=>{
  try{
    const c=req.body;
    const p=await getPool();
    await p.request()
  .input('suc', sql.SmallInt, c.ID_SUCURSAL||1)
  .input('emp', sql.Char(10), c.ID_EMP||'01')
  .input('tal', sql.Char(10), c.CVE_TAL||'01')
  .input('alm', sql.Char(10), c.NUM_ALM||'01')
  .input('ven', sql.Char(10), c.CVE_VEN||'01')
  .input('tipo', sql.Char(10), c.TIPO_PED||'WEB')
  .input('wa', sql.VarChar(20), c.WHATSAPP_REPARTO||'')
  .input('nom', sql.VarChar(100), c.NOMBRE_TIENDA||'TIENDA WEB - SYSPTV')
  .query(`UPDATE dbo.CFG_TIENDA_WEB SET ID_SUCURSAL=@suc, ID_EMP=@emp, CVE_TAL=@tal, NUM_ALM=@alm, CVE_VEN=@ven, TIPO_PED=@tipo, WHATSAPP_REPARTO=@wa, NOMBRE_TIENDA=@nom WHERE ID=1`);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/test', async(req,res)=>{
  try{ const p=await getPool(); res.json({ok:true, db:process.env.DB_NAME}); }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool();
    const cfgQ=await p.request().query(`SELECT * FROM dbo.CFG_TIENDA_WEB WHERE ID=1`);
    const cfg=cfgQ.recordset[0];

    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre=(d.nombre||'CLIENTE WEB').slice(0,100);
    const direccion=(d.direccion||'').slice(0,200);

    await p.request()
  .input('cve', sql.VarChar(20), tel)
  .input('des', sql.VarChar(100), nombre)
  .input('dir', sql.VarChar(200), direccion)
  .input('tel', sql.VarChar(30), (d.telefono||'').slice(0,30))
  .query(`IF NOT EXISTS(SELECT 1 FROM dbo.C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO dbo.C_CLIENTE (CVE_CTE,DES_CTE,DIR_CTE,TEL_CTE,TIPO_CTE,FEC_ALTA) VALUES (@cve,@des,@dir,@tel,'WEB',GETDATE())`);

    // PLANTILLA: último pedido que SÍ abre en SYSPTV
    const plantQ = await p.request().query(`SELECT TOP 1 * FROM dbo.TH_PEDIDO WHERE ID_SUCURSAL=${cfg.ID_SUCURSAL} AND ID_EMP='${cfg.ID_EMP.trim()}' ORDER BY NUM_PED DESC`);
    if(!plantQ.recordset[0]) throw new Error('Haz primero un pedido manual en SYSPTV para usarlo de plantilla');
    const tpl = plantQ.recordset[0];

    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM dbo.TH_PEDIDO WHERE ID_SUCURSAL=${cfg.ID_SUCURSAL} AND ID_EMP='${cfg.ID_EMP.trim()}' AND TIPO_PED='${cfg.TIPO_PED.trim()}'`);
    const folio=fr.recordset[0].folio;
    const tot = parseFloat(d.total||0);

    // CLONAMOS TODO para no dejar NULLs que provocan el error de ','
    await p.request()
  .input('suc', sql.SmallInt, cfg.ID_SUCURSAL)
  .input('emp', sql.Char(10), cfg.ID_EMP.trim())
  .input('tipo', sql.Char(10), cfg.TIPO_PED.trim())
  .input('folio', sql.BigInt, folio)
  .input('cve', sql.VarChar(20), tel)
  .input('tot', sql.Decimal(18,2), tot)
  .input('sub', sql.Decimal(18,2), tot)
  .input('obs', sql.VarChar(100), `${nombre} ${direccion}`.slice(0,100).replace(/'/g,''))
  .input('cons', sql.VarChar(20), tel)
  .query(`
      INSERT INTO dbo.TH_PEDIDO (ID_SUCURSAL, ID_EMP, TIPO_PED, NUM_PED, FEC_PED, CVE_CTE, CVE_TAL, ENV_A, CVE_CTE_CONS, CVE_VEN, CVE_TIP_MDA, CVE_ATN, STA_PED, SUB_TOT, IVA_TOT, TOT_PED, OBS_PED, NUM_ALM, FEC_ENT, IVA, DESC_CTE, DESC_FIN, TOT_COS, TIP_CAM, CVE_USU, FEC_MOD)
      SELECT @suc, @emp, @tipo, @folio, GETDATE(), @cve, CVE_TAL, ENV_A, @cons, CVE_VEN, CVE_TIP_MDA, CVE_ATN, 'P', @sub, 0, @tot, @obs, NUM_ALM, DATEADD(day,1,GETDATE()), 0, 0, 0, 0, TIP_CAM, CVE_USU, GETDATE()
      FROM dbo.TH_PEDIDO WHERE ID_SUCURSAL=@suc AND ID_EMP=@emp AND NUM_PED=${tpl.NUM_PED}
    `);

    if(d.productos){
      let par=1;
      for(const prod of d.productos){
        await p.request()
      .input('suc', sql.SmallInt, cfg.ID_SUCURSAL)
      .input('emp', sql.Char(10), cfg.ID_EMP.trim())
      .input('folio', sql.BigInt, folio)
      .input('par', sql.Int, par++)
      .input('cve', sql.Char(20), (prod.cve||'ART').toString().slice(0,20))
      .input('can', sql.Decimal(18,3), parseFloat(prod.cantidad||1))
      .input('pre', sql.Decimal(18,2), parseFloat(prod.precio||0))
      .query(`INSERT INTO dbo.TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,NUM_PAR,CVE_PRO,CAN_PRO,PRE_PRO,CAN_AUT,PRE_COS,STA_PAR,IVA_PRO) VALUES (@suc,@emp,@folio,@par,@cve,@can,@pre,@can,@pre*0.7,'P',0)`);
      }
    }
    res.json({ok:true, folio, cliente:nombre, total:tot, wa:cfg.WHATSAPP_REPARTO});
  }catch(e){
    console.error(e);
    res.status(500).json({ok:false, error:e.message, detalle:e.originalError?.message});
  }
}

app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.post('/api/pedido', guardarPedido);

app.get('*', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('SYSPTV TIENDA WEB FIX corriendo '+PORT));
