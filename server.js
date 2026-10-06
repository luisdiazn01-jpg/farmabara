require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');

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

async function getConfig(){
  try{
    const p=await getPool();
    await p.request().query(`IF OBJECT_ID('CFG_TIENDA_WEB') IS NULL CREATE TABLE CFG_TIENDA_WEB (ID INT PRIMARY KEY, ID_SUCURSAL SMALLINT, ID_EMP VARCHAR(20), CVE_TAL VARCHAR(10), NUM_ALM VARCHAR(10), CVE_VEN VARCHAR(10), TIPO_PED VARCHAR(10))`);
    await p.request().query(`IF NOT EXISTS(SELECT 1 FROM CFG_TIENDA_WEB WHERE ID=1) INSERT INTO CFG_TIENDA_WEB (ID,ID_SUCURSAL,ID_EMP,CVE_TAL,NUM_ALM,CVE_VEN,TIPO_PED) VALUES (1,1,'17072026','01','01','01','WEB')`);
    const r=await p.request().query(`SELECT * FROM CFG_TIENDA_WEB WHERE ID=1`);
    return r.recordset[0]||{ID_SUCURSAL:1, ID_EMP:'17072026'};
  }catch{ return {ID_SUCURSAL:1, ID_EMP:'17072026', CVE_TAL:'01', NUM_ALM:'01', CVE_VEN:'01'}; }
}

app.get('/api/productos', async(req,res)=>{
  try{
    const p=await getPool();
    const r=await p.request().query(`SELECT TOP 500 RTRIM(Articulo) as cve, RTRIM(nombre) as nombre, ISNULL(CAST(Precio as decimal(18,2)),0) as precio FROM CRART WHERE nombre<>'' ORDER BY Articulo`);
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error:e.message}); }
});

async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool();
    const cfg=await getConfig();
    const SUC = parseInt(cfg.ID_SUCURSAL)||1;
    const EMP = String(cfg.ID_EMP).trim()||'17072026'; // TU EMPRESA REAL

    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre=(d.nombre||'CLIENTE WEB').slice(0,100);
    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre)
   .query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE) VALUES (@cve,@des)`);

    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM TH_PEDIDO WHERE ID_SUCURSAL=${SUC} AND ID_EMP='${EMP}'`);
    const folio=fr.recordset[0].folio;
    const tot=parseFloat(d.total||0);

    await p.request()
   .input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP)
   .input('folio', sql.Int, folio).input('cte', sql.VarChar(20), tel)
   .input('fec', sql.DateTime, new Date()).input('fec2', sql.DateTime, new Date(Date.now()+86400000))
   .input('ven', sql.VarChar(10), '01').input('sub', sql.Decimal(18,2), tot/1.16)
   .input('iva', sql.Decimal(18,2), tot - tot/1.16)
   .query(`INSERT INTO TH_PEDIDO (ID_SUCURSAL, ID_EMP, NUM_PED, CVE_CTE, FEC_PED, FEC_ENT, CVE_VEN, SUB_TOT, IVA_TOT, TIPO_PED, STA_PED) VALUES (@suc,@emp,@folio,@cte,@fec,@fec2,@ven,@sub,@iva,'WEB','P')`);

    let par=1;
    for(const prod of d.productos||[]){
      const cveLimpio=(prod.cve||'').toString().replace(/\s+/g,'').trim().substring(0,20);
      const cant=parseFloat(prod.cantidad||1);
      const prec=parseFloat(prod.precio||0);
      await p.request()
     .input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP)
     .input('ped', sql.Int, folio).input('can', sql.Decimal(18,3), cant)
     .input('cve', sql.VarChar(20), cveLimpio).input('pre', sql.Decimal(18,2), prec)
     .input('par', sql.Int, par).input('aut', sql.Decimal(18,3), cant).input('preL', sql.Decimal(18,2), prec)
     .query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,CAN_PRO,CVE_PRO,PRE_PRO,DESC_CTE,DESC_FIN,OBS_PRO,NUM_PAR,CAN_AUT,pre_desc_lista,pre_lista,iva,TIPO,PRE_SOL) VALUES (@suc,@emp,@ped,@can,@cve,@pre,0,0,'',@par,@aut,@preL,@preL,16,'P',@pre)`);
      par++;
    }
    res.json({ok:true, folio, empresa:EMP, sucursal:SUC});
  }catch(e){ console.error(e); res.status(500).json({ok:false, error:e.message, detalle:e.originalError?.message}); }
}

app.post('/api/pedidos', guardarPedido);
app.post('/api/pedido-web', guardarPedido);
app.post('/api/pedido', guardarPedido);

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000, ()=>console.log('V18 Empresa 17072026 OK'));
