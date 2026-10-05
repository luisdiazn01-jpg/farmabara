import express from 'express';
import sql from 'mssql';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const config = {
  user: 'api_tienda',
  password: 'TiendaMaster2026*',
  server: '5.161.229.243',
  database: 'tiendaMaster',
  options: { encrypt: false, trustServerCertificate: true }
};

app.get('/', (req,res) => res.send('FarmaBara puente SYSPTV activo OK'));

app.post('/api/pedido-web', async (req,res)=>{
 try{
  let pool = await sql.connect(config);
  let folioResult = await pool.request().input('psCveEmp', sql.Char(10), '001').execute('spx_FolioPedido');
  let nuevoFolio = parseInt(folioResult.recordset[0].val_fol)+1;
  const { total, iva, tipo_pago, pago_con, carrito } = req.body;
  await pool.request().input('psIdEmp', sql.Char(250), '001').input('psSucursal', sql.Int, 1).input('psNumPed', sql.Int, nuevoFolio).input('psCVE_CTE', sql.Char(250), 'MOSTRADOR').input('psFecPedido', sql.DateTime, new Date()).input('psFecEntrega', sql.DateTime, new Date()).input('psIva', sql.Char(250), String(iva||0)).input('psCVE_VEN', sql.Char(250), 'WEB').input('psCVE_TIP_MDA', sql.Char(250), '1').input('psVAL_TIP_MDA', sql.Char(250), '1').input('psSUB_TOT', sql.Char(250), String(total)).input('psIVA_TOT', sql.Char(250), String(iva)).input('psTIP_PED', sql.Char(250), 'WEB').input('psTIPO_PAGO', sql.Char(50), tipo_pago||'EFECTIVO').input('psPAGO_CON', sql.Float, pago_con||total).input('psOBS_PED', sql.Char(250), 'WEB').execute('spi_THPedido');
  for(let i=0;i<carrito.length;i++){let p=carrito[i]; await pool.request().input('piIdSucursal', sql.Int, 1).input('psIdEmp', sql.Char(10), '001').input('piNum', sql.Int, nuevoFolio).input('piCan', sql.Decimal(18,2), p.cantidad).input('psCvePro', sql.Char(30), p.codigo).input('pdPrePro', sql.Decimal(9,2), p.precio).input('pdDescCte', sql.Decimal(9,2),0).input('pdDescFin', sql.Decimal(9,2),0).input('psObsPro', sql.Char(250), '').input('psNumPar', sql.Int, i+1).input('piPreDescLis', sql.Decimal(9,2), p.precio).input('pdIva', sql.Decimal(18,2),0).input('sTipo', sql.VarChar(2), 'N').execute('spi_DetPedElec');}
  await pool.close();
  res.json({ok:true, folio:nuevoFolio});
 }catch(e){console.error(e); res.status(500).json({ok:false, error:e.message});}
});

app.listen(3000, '0.0.0.0', ()=>console.log('Servidor en puerto 3000'));