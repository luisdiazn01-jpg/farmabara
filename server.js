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
  console.log('✅ DB Conectada:', process.env.DB_NAME);
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
  }catch(e){
    console.log('ERROR crart:', e.message);
    res.status(500).json({error:e.message});
  }
});

app.post('/api/pedidos', async (req,res)=>{
  try{
    const p = await getPool();
    const {nombre, telefono, calle, colonia, ciudad, pago, ubicacion, carrito, total} = req.body;
    await p.request()
   .input('nombre', sql.NVarChar, nombre)
   .input('tel', sql.NVarChar, telefono)
   .input('calle', sql.NVarChar, calle)
   .input('carrito', sql.NVarChar, JSON.stringify(carrito))
   .input('total', sql.Float, total)
   .query(`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Pedidos' AND xtype='U') CREATE TABLE Pedidos (Id INT IDENTITY PRIMARY KEY, Nombre NVARCHAR(100), Telefono NVARCHAR(50), Calle NVARCHAR(200), Carrito NVARCHAR(MAX), Total FLOAT, Fecha DATETIME DEFAULT GETDATE()) INSERT INTO Pedidos (Nombre, Telefono, Calle, Carrito, Total) VALUES (@nombre, @tel, @calle, @carrito, @total)`);
    res.json({ok:true});
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
      const token = jwt.sign({email, rol:'admin'}, SECRET, {expiresIn:'8h'});
      return res.cookie('token', token, {httpOnly:true, sameSite:'lax'}).json({rol:'admin', nombre:'Administrador'});
    }
    const p = await getPool();
    const r = await p.request().input('e', sql.NVarChar, email).query(`SELECT * FROM Clientes WHERE Email=@e`);
    const c = r.recordset[0];
    if(!c) return res.status(401).json({error:'No existe'});
    const ok = await bcrypt.compare(password, c.Password);
    if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
    const token = jwt.sign({email:c.Email, rol:'cliente', id:c.Id, nombre:c.Nombre}, SECRET, {expiresIn:'8h'});
    res.cookie('token', token, {httpOnly:true, sameSite:'lax'}).json({rol:'cliente', nombre:c.Nombre});
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.get('/api/me', verificarToken, (req,res)=> res.json(req.user));
app.post('/api/logout', (req,res)=>{ res.clearCookie('token'); res.json({ok:true}) });
app.get('/admin.html', verificarToken, soloAdmin, (req,res)=> res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/health', (req,res)=> res.send('ok'));
app.listen(PORT, ()=> console.log(`🚀 SYSPTV V-FINAL corriendo en ${PORT}`));
