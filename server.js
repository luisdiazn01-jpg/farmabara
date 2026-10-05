require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const sql = require('mssql');
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT||'1433'),
  options:{encrypt:false, trustServerCertificate:true}
};
let pool;
async function getPool(){ if(pool?.connected) return pool; pool=await sql.connect(sqlConfig); return pool; }

app.get('/api/test', async(req,res)=>{
  try{ const p=await getPool(); res.json({ok:true, db:process.env.DB_NAME, user:process.env.DB_USER, ruta_ok:true}); }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool();
    const tel=(d.telefono||d.tel||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre = d.nombre||d.cliente||'CLIENTE WEB';
    const direccion = d.direccion||d.calle||'';
    const total = d.total||0;

    console.log('Pedido entrando:', nombre, tel, total);

    await p.request()
  .input('cve', sql.VarChar(20), tel)
  .input('des', sql.VarChar(100), nombre.slice(0,100))
  .input('dir', sql.VarChar(200), direccion.slice(0,200))
  .input('tel', sql.VarChar(30), (d.telefono||'').slice(0,30))
  .input('col', sql.VarChar(100), (d.colonia||'').slice(0,100))
  .input('ciu', sql.VarChar(100), (d.ciudad||'CHICOLOAPAN').slice(0,100))
  .query(`IF NOT EXISTS(SELECT 1 FROM dbo.C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO dbo.C_CLIENTE (CVE_CTE,DES_CTE,DIR_CTE,TEL_CTE,COLONIA,CIUDAD,TIPO_CTE,FEC_ALTA) VALUES (@cve,@des,@dir,@tel,@col,@ciu,'WEB',GETDATE()) ELSE UPDATE dbo.C_CLIENTE SET DES_CTE=@des, DIR_CTE=@dir WHERE CVE_CTE=@cve`);

    const plantQ=await p.request().query(`SELECT TOP 1 ID_SUCURSAL,ID_EMP,CVE_TAL,ENV_A,CVE_CTE_CONS,CVE_VEN,CVE_TIP_MDA,CVE_ATN,NUM_ALM FROM dbo.TH_PEDIDO ORDER BY FEC_PED DESC`);
    const pl=plantQ.recordset[0]||{ID_SUCURSAL:1, ID_EMP:'01', CVE_TAL:'01', ENV_A:'A', CVE_CTE_CONS:tel, CVE_VEN:'01', CVE_TIP_MDA:'01', CVE_ATN:'01', NUM_ALM:'01'};

    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM dbo.TH_PEDIDO WHERE TIPO_PED='WEB'`);
    const folio=fr.recordset[0].folio;

    await p.request()
  .input('suc', sql.SmallInt, pl.ID_SUCURSAL)
  .input('emp', sql.Char(10), (pl.ID_EMP||'01').toString().trim())
  .input('tal', sql.Char(10), (pl.CVE_TAL||'01').toString().trim())
  .input('env', sql.Char(10), (pl.ENV_A||'A').toString().trim())
  .input('cons', sql.Char(20), (pl.CVE_CTE_CONS||tel).toString().trim())
  .input('ven', sql.Char(10), (pl.CVE_VEN||'01').toString().trim())
  .input('mda', sql.Char(10), (pl.CVE_TIP_MDA||'01').toString().trim())
  .input('atn', sql.Char(10), (pl.CVE_ATN||'01').toString().trim())
  .input('alm', sql.Char(10), (pl.NUM_ALM||'01').toString().trim())
  .input('folio', sql.BigInt, folio)
  .input('cve', sql.VarChar(20), tel)
  .input('obs', sql.VarChar(100), `${nombre} ${direccion} GPS:${d.lat||''},${d.lng||''}`.slice(0,100))
  .input('tot', sql.Decimal(18,2), parseFloat(total||0))
  .query(`INSERT INTO dbo.TH_PEDIDO (ID_SUCURSAL,ID_EMP,TIPO_PED,NUM_PED,FEC_PED,CVE_CTE,CVE_TAL,ENV_A,CVE_CTE_CONS,CVE_VEN,CVE_TIP_MDA,CVE_ATN,STA_PED,SUB_TOT,IVA_TOT,OBS_PED,NUM_ALM,FEC_ENT,IVA,DESC_CTE,DESC_FIN) VALUES (@suc,@emp,'WEB',@folio,GETDATE(),@cve,@tal,@env,@cons,@ven,@mda,@atn,'P',@tot,0,@obs,@alm,DATEADD(day,1,GETDATE()),0,0,0)`);

    if(d.productos){
      let par=1;
      for(const prod of d.productos){
        await p.request()
      .input('suc', sql.SmallInt, pl.ID_SUCURSAL)
      .input('emp', sql.Char(10), (pl.ID_EMP||'01').toString().trim())
      .input('folio', sql.BigInt, folio)
      .input('par', sql.Int, par++)
      .input('cve', sql.Char(20), (prod.cve||prod.id||'ART').toString().slice(0,20))
      .input('can', sql.Decimal(18,3), parseFloat(prod.cantidad||prod.cant||1))
      .input('pre', sql.Decimal(18,2), parseFloat(prod.precio||0))
      .query(`INSERT INTO dbo.TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,NUM_PAR,CVE_PRO,CAN_PRO,PRE_PRO,CAN_AUT) VALUES (@suc,@emp,@folio,@par,@cve,@can,@pre,@can)`);
      }
    }
    console.log('PEDIDO GUARDADO:', folio);
    res.json({ok:true, folio, cve:tel});
  }catch(e){
    console.error('ERROR PEDIDO:', e);
    res.status(500).json({ok:false, error:e.message, detalle:e.originalError?.message});
  }
}

// AQUI ESTABA EL ERROR: tu frontend llama a /api/pedido-web
app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.post('/api/pedido', guardarPedido);

app.get('*', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('Tienda corriendo '+PORT+' DB:'+process.env.DB_NAME));
