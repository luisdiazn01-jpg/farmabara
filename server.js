import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dbConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASS || 'FarmaBara2024!',
  server: process.env.DB_SERVER || 'mssql',
  database: process.env.DB_NAME || 'master',
  options: { encrypt: false, trustServerCertificate: true }
};

const otps = new Map();

async function initDB(){
 try{
  const pool = await sql.connect(dbConfig);
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Clientes' AND xtype='U')
    CREATE TABLE Clientes (
      id INT IDENTITY(1,1) PRIMARY KEY,
      telefono VARCHAR(20) UNIQUE NOT NULL,
      nombre VARCHAR(100),
      direccion VARCHAR(250),
      creado DATETIME DEFAULT GETDATE()
    );
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Pedidos' AND xtype='U')
    CREATE TABLE Pedidos (
      id INT IDENTITY(1,1) PRIMARY KEY,
      cliente_id INT FOREIGN KEY REFERENCES Clientes(id),
      productos NVARCHAR(MAX),
      total DECIMAL(10,2),
      status VARCHAR(20) DEFAULT 'pendiente',
      fecha DATETIME DEFAULT GETDATE()
    );
  `);
  console.log('DB OK - Tablas creadas');
 }catch(e){ console.log('DB aun iniciando...', e.message); }
}
initDB();

// MODO PRUEBA: genera OTP y lo regresa visible
app.post('/api/login-request', (req,res)=>{
  const { telefono } = req.body;
  if(!telefono) return res.status(400).json({error:'telefono requerido'});
  const otp = Math.floor(100000 + Math.random()*900000).toString();
  otps.set(telefono, { otp, expires: Date.now()+5*60*1000 });
  console.log(`OTP para ${telefono}: ${otp}`);
  const waLink = `https://wa.me/525534244092?text=Tu%20codigo%20FarmaBara%20es%20${otp}`;
  res.json({ ok:true, otp, waLink });
});

app.post('/api/verify-otp', async (req,res)=>{
  const { telefono, otp, nombre, direccion } = req.body;
  const record = otps.get(telefono);
  if(!record || record.otp !== otp || record.expires < Date.now()){
    return res.status(400).json({error:'codigo invalido o expirado'});
  }
  otps.delete(telefono);
  try{
    const pool = await sql.connect(dbConfig);
    let result = await pool.request().query(`SELECT * FROM Clientes WHERE telefono='${telefono}'`);
    let cliente;
    if(result.recordset.length===0){
      const insert = await pool.request().query(`INSERT INTO Clientes (telefono,nombre,direccion) OUTPUT INSERTED.* VALUES ('${telefono}','${(nombre||'').replace(/'/g,"''")}','${(direccion||'').replace(/'/g,"''")}')`);
      cliente = insert.recordset[0];
    }else{
      cliente = result.recordset[0];
    }
    res.json({ ok:true, cliente });
  }catch(e){
    res.json({ ok:true, cliente:{ telefono, nombre, direccion, id: Date.now() }, modo:'demo' });
  }
});

app.post('/api/pedidos', async (req,res)=>{
  const { cliente_id, telefono, productos, total } = req.body;
  try{
    const pool = await sql.connect(dbConfig);
    await pool.request().query(`INSERT INTO Pedidos (cliente_id, productos, total) VALUES (${cliente_id||'NULL'}, '${JSON.stringify(productos).replace(/'/g,"''")}', ${total})`);
    res.json({ok:true});
  }catch(e){ res.json({ok:true, demo:true}); }
});

app.get('/admin', (req,res)=> res.sendFile(path.join(__dirname,'public','admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('FarmaBara v3 en '+PORT));