require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const sql = require('mssql');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'farmabara_secreto_2026_super_seguro';

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// MIDDLEWARES AUTH
function verificarToken(req,res,next){
  const token = req.cookies.token;
  if(!token) return res.status(401).json({error:'No logueado'});
  try{
    req.user = jwt.verify(token, SECRET);
    next();
  }catch(e){
    return res.status(401).json({error:'Token invalido'});
  }
}
function soloAdmin(req,res,next){
  if(req.user.rol!== 'admin') return res.status(403).json({error:'Solo admin'});
  next();
}

// CONEXION DB
sql.connect(dbConfig).then(()=> console.log('DB Conectada')).catch(e=> console.error(e));

// RUTAS PRODUCTOS
app.get('/api/productos', async (req,res)=>{
  try{
    const r = await sql.query`SELECT * FROM Productos`;
    res.json(r.recordset);
  }catch(e){ res.status(500).json({error:e.message}) }
});

// RUTAS PEDIDOS
app.post('/api/pedidos', async (req,res)=>{
  try{
    const {nombre, telefono, calle, colonia, ciudad, pago, ubicacion, carrito, total} = req.body;
    const carritoJson = JSON.stringify(carrito);
    await sql.query`INSERT INTO Pedidos (Nombre, Telefono, Calle, Colonia, Ciudad, Pago, Ubicacion, Carrito, Total, Fecha) VALUES (${nombre}, ${telefono}, ${calle}, ${colonia}, ${ciudad}, ${pago}, ${ubicacion}, ${carritoJson}, ${total}, GETDATE())`;
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}) }
});

// RUTAS CLIENTES - REGISTRO Y LOGIN
app.post('/api/registro', async (req,res)=>{
  try{
    const {nombre, email, password, telefono} = req.body;
    if(!email ||!password) return res.status(400).json({error:'Faltan datos'});
    const hash = await bcrypt.hash(password, 10);
    await sql.query`IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Clientes' AND xtype='U') CREATE TABLE Clientes (Id INT IDENTITY PRIMARY KEY, Nombre NVARCHAR(100), Email NVARCHAR(100) UNIQUE, Password NVARCHAR(200), Telefono NVARCHAR(50), Fecha DATETIME DEFAULT GETDATE())`;
    await sql.query`INSERT INTO Clientes (Nombre, Email, Password, Telefono) VALUES (${nombre}, ${email}, ${hash}, ${telefono})`;
    res.json({ok:true, msg:'Registrado'});
  }catch(e){
    if(e.message.includes('UNIQUE')) return res.status(400).json({error:'Email ya registrado'});
    res.status(500).json({error:e.message})
  }
});

app.post('/api/login', async (req,res)=>{
  try{
    const {email, password} = req.body;
    // ADMIN HARCODEADO
    if(email === 'admin' && password === 'Admin2026!'){
      const token = jwt.sign({email, rol:'admin'}, SECRET, {expiresIn:'8h'});
      res.cookie('token', token, {httpOnly:true, sameSite:'lax'}).json({rol:'admin'});
      return;
    }
    const r = await sql.query`SELECT * FROM Clientes WHERE Email=${email}`;
    const cliente = r.recordset[0];
    if(!cliente) return res.status(401).json({error:'Usuario no existe'});
    const ok = await bcrypt.compare(password, cliente.Password);
    if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
    const token = jwt.sign({email:cliente.Email, rol:'cliente', id:cliente.Id, nombre:cliente.Nombre}, SECRET, {expiresIn:'8h'});
    res.cookie('token', token, {httpOnly:true, sameSite:'lax'}).json({rol:'cliente', nombre:cliente.Nombre});
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.get('/api/me', verificarToken, (req,res)=>{
  res.json(req.user);
});

app.post('/api/logout', (req,res)=>{
  res.clearCookie('token');
  res.json({ok:true});
});

// PROTEGE ADMIN.HTML - SOLO ADMIN PUEDE ENTRAR
app.get('/admin.html', verificarToken, soloAdmin, (req,res)=>{
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// HEALTHCHECK PARA COOLIFY
app.get('/health', (req,res)=> res.send('ok'));

app.listen(PORT, ()=>{
  console.log(`V24 CON LOGIN ADMIN + CLIENTES OK en ${PORT}`);
  console.log(`ADMIN CREADO: admin / Admin2026!`);
});
