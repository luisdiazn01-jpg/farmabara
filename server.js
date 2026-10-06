require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const sql = require('mssql');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'sysptv_2026_super_secreto';

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

let pool;
async function getPool(){
  if(pool && pool.connected) return pool;
  pool = await sql.connect(dbConfig);
  return pool;
}

function verificarToken(req,res,next){
  const token = req.cookies.token;
  if(!token) return res.status(401).json({error:'No logueado'});
  try{ req.user = jwt.verify(token, SECRET); next(); }
  catch{ return res.status(401).json({error:'Token invalido'}); }
}
function soloAdmin(req,res,next){
  if(req.user.rol!=='admin') return res.status(403).json({error:'Solo admin'});
  next();
}

app.get('/api/productos', async (req,res)=>{
  try{
    const p = await getPool();
    const r = await p.request().query(`SELECT TOP 300 * FROM crart WHERE Nombre IS NOT NULL AND LTRIM(RTRIM(Nombre)) <> '' ORDER BY Nombre ASC`);
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error:e.message}); }
});

// PEDIDO YA USANDO th_pedido y td_pedido - ESTE ES EL BUENO
app.post('/api/pedidos', async (req,res)=>{
  try{
    const p = await getPool();
    const {nombre, telefono, calle, colonia, ciudad, pago, ubicacion, carrito, total} = req.body;

    console.log('Guardando en th_pedido:', nombre, total, carrito.length + ' productos');

    // 1. Guardar encabezado en th_pedido
    // Si tu th_pedido tiene otros nombres de columnas, aquí es donde se ajusta
    const direccion = `${calle} ${colonia} ${ciudad} ${ubicacion||''}`.substring(0,250);

    const header = await p.request()
  .input('cliente', sql.NVarChar, nombre)
  .input('tel', sql.NVarChar, telefono)
  .input('dir', sql.NVarChar, direccion)
  .input('pago', sql.NVarChar, pago)
  .input('total', sql.Float, total)
  .query(`
     INSERT INTO th_pedido (Cliente, Telefono, Direccion, FormaPago, Total, Fecha, Estatus)
     VALUES (@cliente, @tel, @dir, @pago, @total, GETDATE(), 'PENDIENTE');
     SELECT SCOPE_IDENTITY() as id;
   `);

    const idPedido = header.recordset[0].id;
    console.log('Pedido creado ID:', idPedido);

    // 2. Guardar detalle en td_pedido
    for(const item of carrito){
      await p.request()
     .input('idPed', sql.Int, idPedido)
     .input('prod', sql.NVarChar, item.nombre)
     .input('cant', sql.Int, 1)
     .input('precio', sql.Float, item.precio)
     .query(`INSERT INTO td_pedido (IdPedido, Producto, Cantidad, Precio) VALUES (@idPed, @prod, @cant, @precio)`);
    }

    res.json({ok:true, id:idPedido});
  }catch(e){
    console.log('ERROR th_pedido:', e.message);
    // Te mando el error exacto para ver si tu th_pedido tiene otros nombres de columnas
    res.status(500).json({error:e.message, detalle: e.message})
  }
});

// VER PEDIDOS DESDE th_pedido
app.get('/api/pedidos', verificarToken, soloAdmin, async (req,res)=>{
  try{
    const p = await getPool();
    const r = await p.request().query(`SELECT TOP 100 * FROM th_pedido ORDER BY Fecha DESC, Id DESC`);
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.get('/api/pedidos/:id', verificarToken, soloAdmin, async (req,res)=>{
  try{
    const p = await getPool();
    const h = await p.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM th_pedido WHERE Id=@id`);
    const d = await p.request().input('id', sql.Int, req.params.id).query(`SELECT * FROM td_pedido WHERE IdPedido=@id`);
    res.json({header:h.recordset[0], detalle:d.recordset});
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.post('/api/registro', async (req,res)=>{
  try{
    const p = await getPool();
    await p.request().query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Clientes' AND xtype='U') CREATE TABLE Clientes (Id INT IDENTITY PRIMARY KEY, Nombre NVARCHAR(100), Email NVARCHAR(100) UNIQUE, Password NVARCHAR(200), Telefono NVARCHAR(50), Fecha DATETIME DEFAULT GETDATE())`);
    const {nombre, email, password, telefono} = req.body;
    const hash = await bcrypt.hash(password, 10);
    await p.request().input('n', sql.NVarChar, nombre).input('e', sql.NVarChar, email).input('p', sql.NVarChar, hash).input('t', sql.NVarChar, telefono).query(`INSERT INTO Clientes (Nombre, Email, Password, Telefono) VALUES (@n, @e, @p, @t)`);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.post('/api/login', async (req,res)=>{
  try{
    const {email, password} = req.body;
    if(email==='admin' && password==='Admin2026!'){
      const token = jwt.sign({email, rol:'admin', nombre:'Admin'}, SECRET, {expiresIn:'8h'});
      return res.cookie('token', token, {httpOnly:true, sameSite:'lax'}).json({rol:'admin', nombre:'Admin'});
    }
    const p = await getPool();
    const r = await p.request().input('e', sql.NVarChar, email).query(`SELECT * FROM Clientes WHERE Email=@e`);
    const c = r.recordset[0];
    if(!c) return res.status(401).json({error:'No existe'});
    const ok = await bcrypt.compare(password, c.Password);
    if(!ok) return res.status(401).json({error:'Pass mal'});
    const token = jwt.sign({email:c.Email, rol:'cliente', id:c.Id, nombre:c.Nombre}, SECRET, {expiresIn:'8h'});
    res.cookie('token', token, {httpOnly:true, sameSite:'lax'}).json({rol:'cliente', nombre:c.Nombre});
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.get('/api/me', verificarToken, (req,res)=> res.json(req.user));
app.post('/api/logout', (req,res)=>{ res.clearCookie('token'); res.json({ok:true}) });
app.get('/health', (req,res)=> res.send('ok'));

app.listen(PORT, ()=> console.log(`🚀 FINAL con th_pedido/td_pedido en ${PORT}`));
