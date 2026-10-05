const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json());

const publicPath = path.join(__dirname, 'public');
console.log('Buscando public en:', publicPath);
console.log('Existe public?', fs.existsSync(publicPath));
if(fs.existsSync(publicPath)) console.log('Archivos en public:', fs.readdirSync(publicPath));

app.use(express.static(publicPath));

// ... aquí dejas tus /api/pedido-web y /api/pedidos-web igual ...

app.get('/api/test', (req,res)=> res.json({ok:true, publicPath, files: fs.existsSync(publicPath) ? fs.readdirSync(publicPath) : []}));

app.get('/', (req,res)=>{
  res.sendFile(path.join(publicPath, 'index.html'), (err)=>{
    if(err) res.status(404).send(`No encontré public/index.html en ${publicPath}. Archivos: ${fs.existsSync(publicPath) ? fs.readdirSync(publicPath).join(',') : 'no existe public'}`);
  });
});

app.get('/admin', (req,res)=> res.sendFile(path.join(publicPath, 'admin.html')));

app.get('*', (req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'API no encontrada'});
  res.sendFile(path.join(publicPath, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`SYSPTV corriendo en ${PORT}`));