// COPIA ESTO COMPLETO EN TU server.js
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const app = express();
app.use(cors()); app.use(express.json()); app.use(express.static(__dirname));

const config = {
  user: process.env.DB_USER, password: process.env.DB_PASS,
  server: process.env.DB_HOST, database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true }
};
let pool; async function getPool(){ if(pool && pool.connected) return pool; pool = await sql.connect(config); return pool; }

app.post('/api/pedido-web', async (req,res)=>{
  const { productos, total, nombre, telefono, direccion, colonia, referencia, lat, lng } = req.body;
  const t = new sql.Transaction(await getPool());
  try{
    await t.begin();
    const tel = (telefono+'').replace(/\D/g,'').slice(-10);
    const cve = `WEB${tel}`; const nombreWeb = (nombre||'WEB').toUpperCase().substring(0,80);
    const mapsUrl = (lat && lng)? `https://www.google.com/maps?q=${lat},${lng}` : null;
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().substring(0,45);

    await new sql.Request(t).input('cve', sql.VarChar, cve).input('des', sql.VarChar, nombreWeb).input('dir', sql.VarChar, direccion||'').input('tel', sql.VarChar, telefono)
     .query(`IF NOT EXISTS (SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE,DIR_CTE,TEL_CTE,TIPO_CTE) VALUES (@cve,@des,@dir,@tel,'WEB')`);

    let r = await new sql.Request(t).query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as f FROM TH_PEDIDO WHERE ID_SUCURSAL=1`);
    const folio = r.recordset[0].f;

    await new sql.Request(t).input('folio', sql.Int, folio).input('cve', sql.VarChar, cve).input('total', sql.Decimal(12,2), total)
     .query(`INSERT INTO TH_PEDIDO (ID_SUCURSAL,NUM_PED,FEC_PED,CVE_CTE,TIPO_PED,ID_EMP,SU_PED,TOT_PED) VALUES (1,@folio,GETDATE(),@cve,'WEB','001',@total,@total)`);

    for(const p of productos){
      await new sql.Request(t).input('folio', sql.Int, folio).input('cod', sql.VarChar, p.codigo||'').input('cant', sql.Decimal(10,2), p.cantidad||1).input('prec', sql.Decimal(10,2), p.precio||0)
       .query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL,NUM_PED,COD_ART,CANT,PRECIO) VALUES (1,@folio,@cod,@cant,@prec)`);
    }
    await new sql.Request(t).input('folio', sql.Int, folio).input('lat', sql.Decimal(10,7), lat||null).input('lng', sql.Decimal(10,7), lng||null).input('maps', sql.VarChar, mapsUrl).input('ip', sql.VarChar, ip).input('col', sql.VarChar, colonia||'').input('ref', sql.NVarChar, referencia||'')
     .query(`INSERT INTO PedidosWeb_Mapping (id_sucursal,num_ped,lat,lng,maps_url,ip_cliente,colonia,referencia) VALUES (1,@folio,@lat,@lng,@maps,@ip,@col,@ref)`);

    await t.commit(); res.json({ok:true, folio, cve_cte:cve, maps_url: mapsUrl});
  }catch(e){ try{ await t.rollback(); }catch(_){} res.status(500).json({error:e.message}); }
});
app.get('/api/pedidos-web', async (req,res)=>{
  const p = await getPool(); const r = await p.request().query(`SELECT h.NUM_PED as folio,h.FEC_PED as fecha,c.DES_CTE as cliente,c.TEL_CTE as telefono,ISNULL(h.TOT_PED,h.SU_PED) as total,m.lat,m.lng,m.maps_url,m.colonia,m.referencia FROM TH_PEDIDO h JOIN C_CLIENTE c ON c.CVE_CTE=h.CVE_CTE LEFT JOIN PedidosWeb_Mapping m ON m.num_ped=h.NUM_PED WHERE h.TIPO_PED='WEB' ORDER BY h.FEC_PED DESC`);
  res.json(r.recordset);
});
app.listen(process.env.PORT||3000);