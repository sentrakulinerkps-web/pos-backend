const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } }); // Allow all origins – restrict in production

app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.json());

// ---------- Database setup ----------
const db = new sqlite3.Database('./pos.db');

db.serialize(() => {
  // Create a single table to store key-value pairs (for simple data)
  db.run(`CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Insert default values if not present
  const defaults = [
    ['orderNo', '1'],
    ['lastResetDate', new Date().toDateString()],
    ['drivers', JSON.stringify(['THORN','DOM','POZZAL','ETC','EXTRA'])],
    ['spareCurrency', JSON.stringify({ code: 'IDR', symbol: 'Rp', rate: 4000 / 17000 })],
    ['notepad', ''],
    ['orders', '{}']
  ];
  defaults.forEach(([key, val]) => {
    db.run(`INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)`, [key, val]);
  });
});

// Helper to get a value
function get(key, callback) {
  db.get(`SELECT value FROM kv WHERE key = ?`, [key], (err, row) => {
    if (err) return callback(err);
    callback(null, row ? row.value : null);
  });
}

// Helper to set a value
function set(key, value, callback) {
  db.run(`REPLACE INTO kv (key, value) VALUES (?, ?)`, [key, value], callback);
}

// Helper to get parsed JSON
function getJSON(key, callback) {
  get(key, (err, val) => {
    if (err) return callback(err);
    try {
      callback(null, val ? JSON.parse(val) : null);
    } catch (e) {
      callback(e);
    }
  });
}

// Helper to set JSON
function setJSON(key, obj, callback) {
  set(key, JSON.stringify(obj), callback);
}

// ---------- API Endpoints ----------

// Get current order number
app.get('/api/orderNo', (req, res) => {
  get('orderNo', (err, val) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ orderNo: parseInt(val) || 1 });
  });
});

// Set order number
app.post('/api/orderNo', (req, res) => {
  const { orderNo } = req.body;
  if (!orderNo || orderNo < 1) return res.status(400).json({ error: 'Invalid order number' });
  set('orderNo', orderNo.toString(), (err) => {
    if (err) return res.status(500).json({ error: err.message });
    io.emit('orderNoChanged', orderNo);
    res.json({ success: true });
  });
});

// Get last reset date
app.get('/api/lastResetDate', (req, res) => {
  get('lastResetDate', (err, val) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ lastResetDate: val || new Date().toDateString() });
  });
});

// Set last reset date (used by daily reset)
app.post('/api/lastResetDate', (req, res) => {
  const { lastResetDate } = req.body;
  set('lastResetDate', lastResetDate, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    io.emit('lastResetDateChanged', lastResetDate);
    res.json({ success: true });
  });
});

// Get all orders
app.get('/api/orders', (req, res) => {
  getJSON('orders', (err, orders) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(orders || {});
  });
});

// Create/update an order
app.post('/api/orders/:id', (req, res) => {
  const id = req.params.id;
  const orderData = req.body;
  getJSON('orders', (err, orders) => {
    if (err) return res.status(500).json({ error: err.message });
    orders = orders || {};
    orders[id] = orderData;
    setJSON('orders', orders, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('orderChanged', { id, order: orderData });
      res.json({ success: true });
    });
  });
});

// Delete an order
app.delete('/api/orders/:id', (req, res) => {
  const id = req.params.id;
  getJSON('orders', (err, orders) => {
    if (err) return res.status(500).json({ error: err.message });
    if (orders && orders[id]) {
      delete orders[id];
      setJSON('orders', orders, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('orderDeleted', id);
        res.json({ success: true });
      });
    } else {
      res.status(404).json({ error: 'Order not found' });
    }
  });
});

// Get drivers
app.get('/api/drivers', (req, res) => {
  getJSON('drivers', (err, drivers) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(drivers || ['THORN','DOM','POZZAL','ETC','EXTRA']);
  });
});

// Update drivers
app.post('/api/drivers', (req, res) => {
  const { drivers } = req.body;
  if (!Array.isArray(drivers)) return res.status(400).json({ error: 'Drivers must be an array' });
  setJSON('drivers', drivers, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    io.emit('driversChanged', drivers);
    res.json({ success: true });
  });
});

// Get spare currency
app.get('/api/spareCurrency', (req, res) => {
  getJSON('spareCurrency', (err, currency) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(currency || { code: 'IDR', symbol: 'Rp', rate: 4000 / 17000 });
  });
});

// Update spare currency
app.post('/api/spareCurrency', (req, res) => {
  const currency = req.body;
  setJSON('spareCurrency', currency, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    io.emit('spareCurrencyChanged', currency);
    res.json({ success: true });
  });
});

// Get notepad
app.get('/api/notepad', (req, res) => {
  get('notepad', (err, text) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ notepad: text || '' });
  });
});

// Update notepad
app.post('/api/notepad', (req, res) => {
  const { notepad } = req.body;
  set('notepad', notepad, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    io.emit('notepadChanged', notepad);
    res.json({ success: true });
  });
});

// ---------- Start server ----------
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
