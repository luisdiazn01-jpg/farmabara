require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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
  // Crear tabla de config si no existe
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

// CONFIG - para tu plantilla admin
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

app.get('/api/productos', async(req,res)=>{
  try{
    const p=await getPool();
    const r=await p.request().query(`SELECT TOP 100 CVE_PRO as cve, DES_PRO as nombre, PRE_PRO as precio, ISNULL(CVE_PRO,'') as clave FROM dbo.C_PROD ORDER BY DES_PRO`);
    res.json(r.recordset);
  }catch(e){
    // fallback si no existe C_PROD
    res.json([{cve:'COCA600', nombre:'COCA 600ML', precio:25},{cve:'SAB45', nombre:'SABRITAS 45G', precio:18}]);
  }
});

app.get('/api/test', async(req,res)=>{
  try{ const p=await getPool(); res.json({ok:true, db:process.env.DB_NAME, user:process.env.DB_USER}); }catch(e){ res.status(500).json({ok:false, error:e.message}); }
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
   .input('col', sql.VarChar(100), (d.colonia||'').slice(0,100))
   .input('ciu', sql.VarChar(100), (d.ciudad||'CHICOLOAPAN').slice(0,100))
   .query(`IF NOT EXISTS(SELECT 1 FROM dbo.C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO dbo.C_CLIENTE (CVE_CTE,DES_CTE,DIR_CTE,TEL_CTE,COLONIA,CIUDAD,TIPO_CTE,FEC_ALTA) VALUES (@cve,@des,@dir,@tel,@col,@ciu,'WEB',GETDATE()) ELSE UPDATE dbo.C_CLIENTE SET DES_CTE=@des, DIR_CTE=@dir WHERE CVE_CTE=@cve`);

    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM dbo.TH_PEDIDO WHERE ID_SUCURSAL=${cfg.ID_SUCURSAL} AND ID_EMP='${cfg.ID_EMP}' AND TIPO_PED='${cfg.TIPO_PED}'`);
    const folio=fr.recordset[0].folio;

    await p.request()
   .input('suc', sql.SmallInt, cfg.ID_SUCURSAL)
   .input('emp', sql.Char(10), cfg.ID_EMP.trim())
   .input('tal', sql.Char(10), cfg.CVE_TAL.trim())
   .input('alm', sql.Char(10), cfg.NUM_ALM.trim())
   .input('ven', sql.Char(10), cfg.CVE_VEN.trim())
   .input('folio', sql.BigInt, folio)
   .input('cve', sql.VarChar(20), tel)
   .input('obs', sql.VarChar(100), `${nombre} ${direccion}`.slice(0,100))
   .input('tot', sql.Decimal(18,2), parseFloat(d.total||0))
   .query(`
      INSERT INTO dbo.TH_PEDIDO (ID_SUCURSAL,ID_EMP,TIPO_PED,NUM_PED,FEC_PED,CVE_CTE,CVE_TAL,CVE_CTE_CONS,CVE_VEN,CVE_TIP_MDA,CVE_ATN,STA_PED,SUB_TOT,IVA_TOT,OBS_PED,NUM_ALM,FEC_ENT,IVA,DESC_CTE,DESC_FIN,ENV_A)
      VALUES (@suc,@emp,'${cfg.TIPO_PED}',@folio,GETDATE(),@cve,@tal,@cve,@ven,'01','01','P',@tot,0,@obs,@alm,DATEADD(day,1,GETDATE()),0,0,0,'A')
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
       .query(`INSERT INTO dbo.TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,NUM_PAR,CVE_PRO,CAN_PRO,PRE_PRO,CAN_AUT) VALUES (@suc,@emp,@folio,@par,@cve,@can,@pre,@can)`);
      }
    }

    res.json({ok:true, folio, cliente:nombre, total:d.total, wa:cfg.WHATSAPP_REPARTO, sucursal:cfg.ID_SUCURSAL, empresa:cfg.ID_EMP});
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
app.listen(PORT,()=>console.log('SYSPTV TIENDA WEB corriendo puerto '+PORT));
