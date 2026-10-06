// --- AGREGA ARRIBA con los otros requires ---
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const SECRET = process.env.JWT_SECRET || 'farmabara_secreto_2026';

app.use(cookieParser());

// --- MIDDLEWARE PARA VERIFICAR ---
function verificarToken(req,res,next){
  const token = req.cookies.token;
  if(!token) return res.status(401).json({error:'No logueado'});
  try{
    req.user = jwt.verify(token, SECRET);
    next();
  }catch{ res.status(401).json({error:'Token invalido'}) }
}
function soloAdmin(req,res,next){
  if(req.user.rol!== 'admin') return res.status(403).json({error:'Solo admin'});
  next();
}

// --- RUTAS DE CLIENTES ---
app.post('/api/registro', async (req,res)=>{
  const {nombre,email,password,telefono} = req.body;
  const hash = await bcrypt.hash(password, 10);
  await sql.query`INSERT INTO Clientes (Nombre,Email,Password,Telefono) VALUES (${nombre},${email},${hash},${telefono})`;
  res.json({ok:true});
});

app.post('/api/login', async (req,res)=>{
  const {email,password} = req.body;
  // Checa si es admin hardcodeado
  if(email==='admin' && password==='Admin2026!'){
     const token = jwt.sign({email, rol:'admin'}, SECRET, {expiresIn:'8h'});
     res.cookie('token', token, {httpOnly:true}).json({rol:'admin'});
     return;
  }
  const r = await sql.query`SELECT * FROM Clientes WHERE Email=${email}`;
  const cliente = r.recordset[0];
  if(!cliente) return res.status(401).json({error:'No existe'});
  const ok = await bcrypt.compare(password, cliente.Password);
  if(!ok) return res.status(401).json({error:'Pass mal'});
  const token = jwt.sign({email, rol:'cliente', id:cliente.Id}, SECRET, {expiresIn:'8h'});
  res.cookie('token', token, {httpOnly:true}).json({rol:'cliente'});
});

app.get('/api/me', verificarToken, (req,res)=> res.json(req.user) );
app.post('/api/logout', (req,res)=>{ res.clearCookie('token'); res.json({ok:true}) });

// --- PROTEGE TU ADMIN ---
app.get('/admin.html', verificarToken, soloAdmin, (req,res)=>{
  res.sendFile(path.join(__dirname,'public','admin.html'));
});
