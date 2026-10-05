require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const app = express();
app.use(cors());
app.use(express.json());

const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT||'1433'),
  options:{encrypt:false, trustServerCertificate:true}
};
let pool; async function getPool(){ if(pool?.connected) return pool; pool=await sql.connect(sqlConfig); return pool; }

app.get('/api/test', async(req,res)=>{
  try{ const p=await getPool(); const r=await p.request().query(`SELECT DB_NAME() as db, COUNT(*) as total FROM dbo.C_CLIENTE`); res.json({ok:true, db:r.recordset[0].db, env:process.env.DB_NAME}); }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.get('/api/schema', async(req,res)=>{
  try{
    const p=await getPool();
    const th=await p.request().query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TH_PEDIDO' ORDER BY ORDINAL_POSITION`);
    const td=await p.request().query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='TD_PEDIDO' ORDER BY ORDINAL_POSITION`);
    res.json({TH_PEDIDO:th.recordset, TD_PEDIDO:td.recordset});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/pedidos', async(req,res)=>{
  const d=req.body;
  try{
    const p=await getPool();
    const tel = (d.telefono||'').toString().replace(/\D/g,'').slice(0,15) || 'W'+Date.now().toString().slice(-9);
    const lat = d.lat? parseFloat(d.lat) : (d.latitud? parseFloat(d.latitud) : null);
    const lng = d.lng? parseFloat(d.lng) : (d.longitud? parseFloat(d.longitud) : null);

    await p.request()
    .input('cve', sql.VarChar(20), tel)
    .input('des', sql.VarChar(100), (d.nombre||'CLIENTE WEB').slice(0,100))
    .input('dir', sql.VarChar(200), (d.direccion||'').slice(0,200))
    .input('tel', sql.VarChar(30), (d.telefono||'').slice(0,30))
    .input('tipo', sql.VarChar(10), 'WEB')
    .input('col', sql.VarChar(100), (d.colonia||'').slice(0,100))
    .input('ciu', sql.VarChar(100), (d.ciudad||'CHICOLOAPAN').slice(0,100))
    .input('cp', sql.VarChar(10), (d.cp||'').slice(0,10))
    .input('ext', sql.VarChar(20), (d.num_ext||'').slice(0,20))
    .input('int', sql.VarChar(20), (d.num_int||'').slice(0,20))
    .input('lat', sql.Decimal(10,7), isNaN(lat)?null:lat)
    .input('lng', sql.Decimal(10,7), isNaN(lng)?null:lng)
    .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.C_CLIENTE WHERE CVE_CTE=@cve)
          INSERT INTO dbo.C_CLIENTE (CVE_CTE,DES_CTE,DIR_CTE,TEL_CTE,TIPO_CTE,COLONIA,CIUDAD,CP,NUM_EXT,NUM_INT,LATITUD,LONGITUD,FEC_ALTA)
          VALUES (@cve,@des,@dir,@tel,@tipo,@col,@ciu,@cp,@ext,@int,@lat,@lng,GETDATE())
        ELSE
          UPDATE dbo.C_CLIENTE SET DES_CTE=@des,DIR_CTE=@dir,TEL_CTE=@tel,COLONIA=@col,CIUDAD=@ciu,CP=@cp,LATITUD=@lat,LONGITUD=@lng WHERE CVE_CTE=@cve
     `);

    const fr = await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM dbo.TH_PEDIDO WHERE TIPO_PED='WEB'`);
    const folio = fr.recordset[0].folio;

    await p.request()
    .input('folio', sql.Int, folio)
    .input('cve', sql.VarChar(20), tel)
    .input('tot', sql.Decimal(18,2), parseFloat(d.total||0))
    .input('obs', sql.VarChar(500), `${d.nombre||''} ${d.direccion||''} GPS:${lat||''},${lng||''}`.slice(0,500))
    .query(`INSERT INTO dbo.TH_PEDIDO (ID_SUCURSAL,TIPO_PED,NUM_PED,CVE_CTE,FEC_PED,TOT_PED,OBS_PED) VALUES (1,'WEB',@folio,@cve,GETDATE(),@tot,@obs)`);

    if(d.productos && d.productos.length){
      for(const prod of d.productos){
        await p.request()
        .input('folio', sql.Int, folio)
        .input('art', sql.VarChar(20), (prod.cve||prod.id||'GEN').toString().slice(0,20))
        .input('cant', sql.Decimal(18,2), parseFloat(prod.cantidad||1))
        .input('pre', sql.Decimal(18,2), parseFloat(prod.precio||0))
        .query(`INSERT INTO dbo.TD_PEDIDO (ID_SUCURSAL,TIPO_PED,NUM_PED,CVE_ART,CANT_PED,PRE_PED) VALUES (1,'WEB',@folio,@art,@cant,@pre)`);
      }
    }

    console.log('PEDIDO OK', folio);
    res.json({ok:true, folio});

  }catch(e){
    console.error('ERROR PEDIDO:', e);
    res.status(500).json({ok:false, error:e.message, sql:e.originalError?.info?.message||e.message});
  }
});

app.listen(process.env.PORT||3000, ()=>console.log('Tienda tiendaMaster OK'));