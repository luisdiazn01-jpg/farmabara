require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// TUS NOMBRES EXACTOS DE LA IMAGEN
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let pool;
async function getPool() {
  if (pool && pool.connected) return pool;
  pool = await sql.connect(sqlConfig);
  console.log('Conectado a:', sqlConfig.database, 'con', sqlConfig.user, 'en', sqlConfig.server);
  return pool;
}

app.post('/api/pedidos', async (req, res) => {
  try {
    const d = req.body;
    const p = await getPool();
    const cveCte = (d.telefono || d.cve_cte || 'WEB'+Date.now()).toString().substring(0,20).replace(/[^0-9]/g,'').substring(0,20);
    const finalCve = cveCte || 'W' + Date.now().toString().slice(-9);

    // 1. CLIENTE - Estructura real de tu foto
    await p.request()
    .input('cve', sql.VarChar(20), finalCve)
    .input('nom', sql.VarChar(100), d.nombre || d.cliente || 'CLIENTE WEB')
    .input('tel', sql.VarChar(30), d.telefono || '')
    .input('dir', sql.VarChar(200), d.direccion || d.calle || '')
    .input('col', sql.VarChar(100), d.colonia || '')
    .input('ciu', sql.VarChar(100), d.ciudad || 'CHICOLOAPAN')
    .input('cp', sql.VarChar(10), d.cp || d.CP || '')
    .input('ext', sql.VarChar(20), d.num_ext || '')
    .input('int', sql.VarChar(20), d.num_int || '')
    .input('lat', sql.VarChar(20), d.lat || d.latitud || null)
    .input('lng', sql.VarChar(20), d.lng || d.longitud || null)
    .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.C_CLIENTE WHERE CVE_CTE = @cve)
          INSERT INTO dbo.C_CLIENTE (CVE_CTE, DES_CTE, DIR_CTE, TEL_CTE, TIPO_CTE, COLONIA, CIUDAD, CP, NUM_EXT, NUM_INT, LATITUD, LONGITUD, FEC_ALTA)
          VALUES (@cve, @nom, @dir, @tel, 'WEB', @col, @ciu, @cp, @ext, @int, @lat, @lng, GETDATE())
        ELSE
          UPDATE dbo.C_CLIENTE SET DES_CTE=@nom, TEL_CTE=@tel, DIR_CTE=@dir, COLONIA=@col, CIUDAD=@ciu, CP=@cp, LATITUD=@lat, LONGITUD=@lng WHERE CVE_CTE=@cve
      `);

    // 2. FOLIO
    const fr = await p.request().query(`SELECT ISNULL(MAX(NUM_PED),0)+1 as folio FROM dbo.TH_PEDIDO WHERE ID_SUCURSAL=1 AND TIPO_PED='WEB'`);
    const folio = fr.recordset[0].folio;

    // 3. PEDIDO
    await p.request()
    .input('num', sql.Int, folio)
    .input('cve', sql.VarChar(20), finalCve)
    .input('tot', sql.Decimal(18,2), d.total || 0)
    .input('obs', sql.VarChar(500), d.observaciones || `WEB ${d.nombre} - ${d.direccion}`)
    .query(`INSERT INTO dbo.TH_PEDIDO (ID_SUCURSAL, TIPO_PED, NUM_PED, CVE_CTE, FEC_PED, TOT_PED, OBS_PED, ID_EMP, STATUS) VALUES (1, 'WEB', @num, @cve, GETDATE(), @tot, @obs, 1, 'P')`);

    // 4. DETALLE
    if (d.productos) {
      for (let prod of d.productos) {
        await p.request()
        .input('num', sql.Int, folio)
        .input('art', sql.VarChar(20), prod.cve || prod.id || 'ART')
        .input('cant', sql.Decimal(18,3), prod.cantidad || 1)
        .input('pre', sql.Decimal(18,2), prod.precio || 0)
        .query(`INSERT INTO dbo.TD_PEDIDO (ID_SUCURSAL, TIPO_PED, NUM_PED, CVE_ART, CANT_PED, PRE_PED) VALUES (1, 'WEB', @num, @art, @cant, @pre)`);
      }
    }

    res.json({ ok: true, folio, cve: finalCve });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/test', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request().query('SELECT TOP 3 CVE_CTE, DES_CTE, TEL_CTE, TIPO_CTE FROM dbo.C_CLIENTE ORDER BY FEC_ALTA DESC');
    res.json({ ok: true, conectado: sqlConfig, clientes: r.recordset });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, config: { user: sqlConfig.user, server: sqlConfig.server, db: sqlConfig.database, pass_length: sqlConfig.password? sqlConfig.password.length : 0 }});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor corriendo en', PORT));