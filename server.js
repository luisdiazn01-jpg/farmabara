require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const sql = require('mssql');
const app = express();

app.use(cors());
app.use(express.json());
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

// API TEST
app.get('/api/test', async(req,res)=>{
  try{ const p=await getPool(); res.json({ok:true, db:process.env.DB_NAME, user:process.env.DB_USER}); }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.get('/api/schema', async(req,res)=>{
  try{
    const p=await getPool();
    const th=await p.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TH_PEDIDO'`);
    const td=await p.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TD_PEDIDO'`);
    res.json({TH:th.recordset, TD:td.recordset});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/pedidos', async(req,res)=>{
  const d=req.body;
  try{
    const p=await getPool();
    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const lat=d.lat? parseFloat(d.lat):null;
    const lng=d.lng? parseFloat(d.lng):null;

    await p.request()
   .input('cve', sql.VarChar(20), tel)
   .input('des', sql.VarChar(100), (d.nombre||'WEB').slice(0,100))
   .input('dir', sql.VarChar(200), (d.direccion||'').slice(0,200))
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
   .input('obs', sql.VarChar(100), (d.nombre+' '+d.direccion).slice(0,100))
   .input('tot', sql.Decimal(18,2), parseFloat(d.total||0))
   .query(`INSERT INTO dbo.TH_PEDIDO (ID_SUCURSAL,ID_EMP,TIPO_PED,NUM_PED,FEC_PED,CVE_CTE,CVE_TAL,ENV_A,CVE_CTE_CONS,CVE_VEN,CVE_TIP_MDA,CVE_ATN,STA_PED,SUB_TOT,IVA_TOT,OBS_PED,NUM_ALM,FEC_ENT,IVA,DESC_CTE,DESC_FIN) VALUES (@suc,@emp,'WEB',@folio,GETDATE(),@cve,@tal,@env,@cons,@ven,@mda,@atn,'P',@tot,0,@obs,@alm,DATEADD(day,1,GETDATE()),0,0,0)`);

    if(d.productos){
      let par=1;
      for(const prod of d.productos){
        await p.request()
       .input('suc', sql.SmallInt, pl.ID_SUCURSAL)
       .input('emp', sql.Char(10), (pl.ID_EMP||'01').toString().trim())
       .input('folio', sql.BigInt, folio)
       .input('par', sql.Int, par++)
       .input('cve', sql.Char(20), (prod.cve||'ART').toString().slice(0,20))
       .input('can', sql.Decimal(18,3), parseFloat(prod.cantidad||1))
       .input('pre', sql.Decimal(18,2), parseFloat(prod.precio||0))
       .query(`INSERT INTO dbo.TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,NUM_PAR,CVE_PRO,CAN_PRO,PRE_PRO,CAN_AUT) VALUES (@suc,@emp,@folio,@par,@cve,@can,@pre,@can)`);
      }
    }
    res.json({ok:true, folio});
  }catch(e){
    console.error(e);
    res.status(500).json({ok:false, error:e.message, detalle:e.originalError?.message});
  }
});

// IMPORTANTE: Servir el index.html para cualquier otra ruta
app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('Tienda corriendo '+PORT));
