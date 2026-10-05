const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const dbConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'TuPassword123',
  server: process.env.DB_SERVER || 'host.docker.internal',
  database: process.env.DB_DATABASE || 'tiendaMaster',
  options: { encrypt: false, trustServerCertificate: true },
};

let pool;
async function getPool(){
  if(pool && pool.connected) return pool;
  pool = await sql.connect(dbConfig);
  console.log('Conectado a tiendaMaster');
  return pool;
}

async function initTables(){
  try{
    const p = await getPool();
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ProductosWeb' AND xtype='U')
      CREATE TABLE ProductosWeb (id INT IDENTITY(1,1) PRIMARY KEY, codigo VARCHAR(50) UNIQUE NOT NULL, nombre NVARCHAR(200) NOT NULL, precio DECIMAL(10,2) NOT NULL, precio_antes DECIMAL(10,2) NULL, categoria NVARCHAR(100), imagen_url NVARCHAR(500), stock INT DEFAULT 100, descuento NVARCHAR(20), activo BIT DEFAULT 1, fecha_alta DATETIME DEFAULT GETDATE());
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ClientesWeb' AND xtype='U')
      CREATE TABLE ClientesWeb (id INT IDENTITY(1,1) PRIMARY KEY, nombre NVARCHAR(150) NOT NULL, telefono VARCHAR(20) NOT NULL, email NVARCHAR(150), direccion NVARCHAR(300), password_hash NVARCHAR(200), fecha_registro DATETIME DEFAULT GETDATE());
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='InteraccionesWeb' AND xtype='U')
      CREATE TABLE InteraccionesWeb (id INT IDENTITY(1,1) PRIMARY KEY, cliente_id INT NULL, accion NVARCHAR(100), detalle NVARCHAR(500), ip VARCHAR(50), fecha DATETIME DEFAULT GETDATE());
    `);
  }catch(e){ console.error(e.message); }
}
initTables();

// --- CORRECCION IMPORTANTE PARA TU ESTRUCTURA /public ---
const publicPath = path.join(__dirname, 'public');
const uploadsPath = path.join(publicPath, 'uploads');
if(!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, {recursive:true});

app.use('/uploads', express.static(uploadsPath));
app.use(express.static(publicPath)); // <-- sirve todo lo de /public

const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, uploadsPath),
  filename: (req,file,cb)=> cb(null, Date.now()+'-'+file.originalname)
});
const upload = multer({ storage });

app.get('/api/productos', async (req,res)=>{
  try{ const p=await getPool(); let r=await p.request().query('SELECT TOP 200 * FROM ProductosWeb WHERE activo=1 ORDER BY fecha_alta DESC'); res.json(r.recordset); }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/clientes/registro', async (req,res)=>{
  const { nombre, telefono, email, direccion } = req.body;
  if(!nombre||!telefono) return res.status(400).json({error:'Faltan datos'});
  try{ const p=await getPool(); const result=await p.request().input('nombre', sql.NVarChar, nombre).input('telefono', sql.VarChar, telefono).input('email', sql.NVarChar, email||'').input('direccion', sql.NVarChar, direccion||'').query('INSERT INTO ClientesWeb (nombre,telefono,email,direccion) OUTPUT INSERTED.id VALUES (@nombre,@telefono,@email,@direccion)'); res.json({ok:true, cliente_id: result.recordset[0].id}); }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/admin/pedidos', async (req,res)=>{
  try{ const p=await getPool(); const r=await p.request().query('SELECT TOP 100 h.NUM_PED as folio, h.FEC_PED as fecha, h.TOT_PED as total, h.TIPO_PAGO, c.nombre as cliente FROM TH_PEDIDO h LEFT JOIN ClientesWeb c ON c.id=h.CLIENTE_ID ORDER BY h.FEC_PED DESC'); res.json(r.recordset); }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/admin/clientes', async (req,res)=>{ try{ const p=await getPool(); const r=await p.request().query('SELECT TOP 200 * FROM ClientesWeb ORDER BY fecha_registro DESC'); res.json(r.recordset); }catch(e){ res.status(500).json({error:e.message}); } });
app.get('/api/admin/interacciones', async (req,res)=>{ try{ const p=await getPool(); const r=await p.request().query('SELECT TOP 200 i.*, c.nombre FROM InteraccionesWeb i LEFT JOIN ClientesWeb c ON c.id=i.cliente_id ORDER BY i.fecha DESC'); res.json(r.recordset); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/admin/producto', upload.single('imagen'), async (req,res)=>{
  try{
    const { nombre, codigo, precio, precio_antes, categoria, descuento, stock } = req.body;
    const imagen_url = req.file? '/uploads/'+req.file.filename : req.body.imagen_url;
    if(!codigo||!nombre) return res.status(400).json({error:'codigo y nombre requeridos'});
    const p=await getPool();
    await p.request().input('codigo', sql.VarChar, codigo).input('nombre', sql.NVarChar, nombre).input('precio', sql.Decimal(10,2), precio).input('precio_antes', sql.Decimal(10,2), precio_antes||precio*1.3).input('cat', sql.NVarChar, categoria).input('img', sql.NVarChar, imagen_url).input('stock', sql.Int, stock||100).input('desc', sql.NVarChar, descuento||'-25%').query('INSERT INTO ProductosWeb (codigo,nombre,precio,precio_antes,categoria,imagen_url,stock,descuento) VALUES (@codigo,@nombre,@precio,@precio_antes,@cat,@img,@stock,@desc)');
    res.json({ok:true, imagen_url});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/pedido-web', async (req,res)=>{
  const { total, iva, tipo_pago, pago_con, carrito, cliente_id } = req.body;
  if(!carrito || carrito.length===0) return res.status(400).json({error:'Carrito vacio'});
  try{
    const p=await getPool(); const transaction=new sql.Transaction(p); await transaction.begin();
    try{
      let folioRes=await new sql.Request(transaction).query('SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM TH_PEDIDO WHERE ID_SUCURSAL=1');
      let folio=folioRes.recordset[0].folio;
      await new sql.Request(transaction).input('suc', sql.Int, 1).input('folio', sql.Int, folio).input('total', sql.Decimal(10,2), total).input('iva', sql.Decimal(10,2), iva||total*0.16).input('tipo_pago', sql.VarChar, tipo_pago||'EFECTIVO').input('pago_con', sql.Decimal(10,2), pago_con||total).input('cliente', sql.Int, cliente_id||null).query("INSERT INTO TH_PEDIDO (ID_SUCURSAL, NUM_PED, FEC_PED, TOT_PED, IVA_PED, TIPO_PAGO, PAGO_CON, TIPO_PED, ID_EMP, CLIENTE_ID) VALUES (@suc, @folio, GETDATE(), @total, @iva, @tipo_pago, @pago_con, 'WEB', '001', @cliente)");
      for(let item of carrito){ await new sql.Request(transaction).input('suc', sql.Int, 1).input('folio', sql.Int, folio).input('codigo', sql.VarChar, item.codigo).input('cant', sql.Decimal(10,2), item.cantidad).input('precio', sql.Decimal(10,2), item.precio).query('INSERT INTO TD_PEDIDO (ID_SUCURSAL, NUM_PED, CVE_PRO, CAN_PRO, PRE_PRO) VALUES (@suc, @folio, @codigo, @cant, @precio)'); }
      await new sql.Request(transaction).input('cid', sql.Int, cliente_id||null).input('accion', sql.NVarChar, 'PEDIDO').input('detalle', sql.NVarChar, 'Folio '+folio).query('INSERT INTO InteraccionesWeb (cliente_id, accion, detalle) VALUES (@cid,@accion,@detalle)');
      await transaction.commit(); res.json({ok:true, folio});
    }catch(err){ await transaction.rollback(); throw err; }
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.get('/', (req,res)=> res.sendFile(path.join(publicPath,'index.html')));
app.get('/admin.html', (req,res)=> res.sendFile(path.join(publicPath,'admin.html')));
app.get('/health', (req,res)=> res.send('FarmaBara puente SYSPTV activo OK - v2.0 tiendaMaster'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('FarmaBara v2.0 en '+PORT+' sirviendo '+publicPath));