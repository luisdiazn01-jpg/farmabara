//... deja tu config igual arriba...
// SOLO CAMBIA LA FUNCION getProductos y guardarPedido por estas:

app.get('/api/productos', async(req,res)=>{
  try{
    const p=await getPool();
    const r=await p.request().query(`
      SELECT TOP 500
        RTRIM(LTRIM(Articulo)) as cve,
        RTRIM(LTRIM(nombre)) as nombre,
        ISNULL(CAST(NULLIF(Precio,0) as decimal(18,2)), ISNULL(CAST(Precio1 as decimal(18,2)),0)) as precio,
        ISNULL(CAST(Existencias1 as decimal(18,2)),0) as existencia
      FROM dbo.CRART
      WHERE LTRIM(RTRIM(nombre))<>'' AND ISNULL(Existencias1,0) > 0
      ORDER BY nombre
    `);
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error:e.message}) }
});

// LOGIN ADMIN SIMPLE
app.post('/api/admin/login', (req,res)=>{
  const {user, pass} = req.body;
  if(user==='admin' && pass==='Admin2026!'){ res.json({ok:true}); }
  else res.status(401).json({error:'No'});
});

// CONFIG EMPRESA
app.post('/api/admin/config', async(req,res)=>{
  const p=await getPool();
  const c=req.body;
  await p.request()
   .input('suc', sql.SmallInt, c.ID_SUCURSAL)
   .input('emp', sql.VarChar(20), c.ID_EMP)
   .input('nom', sql.VarChar(100), c.NOMBRE_TIENDA)
   .input('whats', sql.VarChar(20), c.WHATSAPP_REPARTO)
   .query(`UPDATE CFG_TIENDA_WEB SET ID_SUCURSAL=@suc, ID_EMP=@emp, NOMBRE_TIENDA=@nom, WHATSAPP_REPARTO=@whats WHERE ID=1`);
  res.json({ok:true});
});

// --- PEDIDO FIX PRECIOS REALES + UBICACION ---
async function guardarPedido(req,res){
  const d=req.body;
  try{
    const p=await getPool();
    const cfg=await getConfigDB();
    const SUC=parseInt(cfg.ID_SUCURSAL)||1;
    const EMP=String(cfg.ID_EMP).trim()||'17072026';
    const tel=(d.telefono||'').toString().replace(/\D/g,'').slice(-10) || 'W'+Date.now().toString().slice(-8);
    const nombre=(d.nombre||'CLIENTE WEB').replace(/'/g,"").slice(0,100);
    const direccion = (d.direccion||'').slice(0,200);
    const lat = d.lat||null; const lng = d.lng||null;

    // Crea tabla de ubicacion si no existe
    await p.request().query(`IF COL_LENGTH('C_CLIENTE','DIRECCION') IS NULL ALTER TABLE C_CLIENTE ADD DIRECCION VARCHAR(200) NULL; IF COL_LENGTH('C_CLIENTE','LAT') IS NULL ALTER TABLE C_CLIENTE ADD LAT VARCHAR(20) NULL; IF COL_LENGTH('C_CLIENTE','LNG') IS NULL ALTER TABLE C_CLIENTE ADD LNG VARCHAR(20) NULL;`);

    await p.request().input('cve', sql.VarChar(20), tel).input('des', sql.VarChar(100), nombre).input('dir', sql.VarChar(200), direccion).input('lat', sql.VarChar(20), lat).input('lng', sql.VarChar(20), lng)
.query(`IF NOT EXISTS(SELECT 1 FROM C_CLIENTE WHERE CVE_CTE=@cve) INSERT INTO C_CLIENTE (CVE_CTE,DES_CTE,DIRECCION,LAT,LNG) VALUES (@cve,@des,@dir,@lat,@lng) ELSE UPDATE C_CLIENTE SET DIRECCION=@dir, LAT=@lat, LNG=@lng WHERE CVE_CTE=@cve`);

    const fr=await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM TH_PEDIDO WHERE ID_SUCURSAL=${SUC} AND ID_EMP='${EMP}'`);
    const folio=fr.recordset[0].folio;

    // CALCULA TOTAL REAL DESDE BD PARA QUE NO CAIGA EN 0
    let totalReal=0;
    let productosReales=[];
    for(const prod of d.productos||[]){
      let cveLimpio=(prod.cve||prod.articulo||'').toString().trim().substring(0,20);
      const rPrecio=await p.request().input('cve', sql.VarChar(20), cveLimpio).query(`SELECT ISNULL(CAST(NULLIF(Precio,0) as decimal(18,2)), ISNULL(CAST(Precio1 as decimal(18,2)),0)) as precio FROM CRART WHERE Articulo=@cve`);
      let precioReal = rPrecio.recordset[0]?.precio || prod.precio || 0;
      if(precioReal==0) precioReal = prod.precio; // fallback
      productosReales.push({cve:cveLimpio, cant: prod.cantidad, precio: precioReal});
      totalReal+=precioReal*prod.cantidad;
    }
    const sub=totalReal/1.16; const iva=totalReal-sub;

    await p.request().input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP).input('folio', sql.Int, folio).input('cte', sql.VarChar(20), tel).input('fec', sql.DateTime, new Date()).input('fec2', sql.DateTime, new Date(Date.now()+86400000)).input('ven', sql.VarChar(10), '01').input('ivaPorc', sql.Decimal(18,2), 16).input('tipMda', sql.VarChar(10), '01').input('valMda', sql.Decimal(18,2), 1).input('sub', sql.Decimal(18,2), sub).input('ivaTot', sql.Decimal(18,2), iva)
.query(`INSERT INTO TH_PEDIDO (ID_SUCURSAL, ID_EMP, NUM_PED, CVE_CTE, FEC_PED, FEC_ENT, IVA, CVE_VEN, CVE_TIP_MDA, VAL_TIP_MDA, SUB_TOT, IVA_TOT, TIPO_PED, STA_PED) VALUES (@suc,@emp,@folio,@cte,@fec,@fec2,@ivaPorc,@ven,@tipMda,@valMda,@sub,@ivaTot,'WEB','P')`);

    let par=1;
    for(const pr of productosReales){
      await p.request().input('suc', sql.SmallInt, SUC).input('emp', sql.VarChar(20), EMP).input('ped', sql.Int, folio).input('can', sql.Decimal(18,3), pr.cant).input('cve', sql.VarChar(20), pr.cve).input('pre', sql.Decimal(18,2), pr.precio).input('par', sql.Int, par).input('aut', sql.Decimal(18,3), pr.cant).input('preL', sql.Decimal(18,2), pr.precio)
.query(`INSERT INTO TD_PEDIDO (ID_SUCURSAL,ID_EMP,NUM_PED,CAN_PRO,CVE_PRO,PRE_PRO,DESC_CTE,DESC_FIN,OBS_PRO,NUM_PAR,CAN_AUT,pre_desc_lista,pre_lista,iva,TIPO,PRE_SOL) VALUES (@suc,@emp,@ped,@can,@cve,@pre,0,0,'',@par,@aut,@preL,@preL,16,'P',@pre)`);
      par++;
    }
    res.json({ok:true, folio, empresa:EMP, total:totalReal});
  }catch(e){ console.error(e); res.status(500).json({ok:false, error:e.message}); }
}
