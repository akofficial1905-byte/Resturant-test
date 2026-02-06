const express  = require('express');
const http     = require('http');
const socketio = require('socket.io');
const cors     = require('cors');
const path     = require('path');
const mongoose = require('mongoose');

const app    = express();
const server = http.createServer(app);
const io     = socketio(server);
const PORT   = process.env.PORT || 3000;

// --- MongoDB Atlas connection (Titishya) ---
const MONGO_URI = 'mongodb+srv://akofficial1905_db_user:FbqAuhCOkXLN0XH1@restaurantdata.kxozvbc.mongodb.net/?appName=RESTAURANTDATA';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected! (Titishya Fast Food)');
});
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

// --- Schema & model (same shape you are using) ---
const orderSchema = new mongoose.Schema({
  orderType: String,
  customerName: String,
  mobile: String,
  tableNumber: String,
  address: String,
  items: Array,
  total: Number,               // server-calculated
  status: { type: String, default: 'incoming' },
  createdAt: { type: Date, default: Date.now, index: true }
});

// auto-expire after 90 days (your existing logic)
orderSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

const Order = mongoose.model('Order', orderSchema);

// --- Middleware & static files ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- IST date helper (Mughlai-style) ---
function getISTDateBounds(dateStr) {
  const date  = dateStr || new Date().toISOString().slice(0, 10);
  const start = new Date(Date.parse(date + 'T00:00:00+05:30'));
  const end   = new Date(Date.parse(date + 'T23:59:59+05:30'));
  return { start, end };
}

// --- Menu file ---
app.get('/menu.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/menu.json'));
});

// ---------------- ORDERS APIs ----------------

// Get orders for a given date (IST), used by Titishya manager.html
app.get('/api/orders', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { start, end } = getISTDateBounds(date);
  const orders = await Order.find({
    createdAt: { $gte: start, $lte: end },
    status: { $ne: 'deleted' }
  }).sort({ createdAt: -1 });
  res.json(orders);
});

// Place new order (called from Titishya customer index.html)
app.post('/api/orders', async (req, res) => {
  const {
    orderType,
    customerName,
    mobile,
    tableNumber,
    address,
    items,
    // paymentMethod, paymentStatus, totalAmount can be added if you store them
  } = req.body;

  // compute total like Mughlai
  const total = (items || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0);

  const order = new Order({
    orderType,
    customerName,
    mobile,
    tableNumber,
    address,
    items,
    total,
    status: 'incoming'
  });

  await order.save();
  io.emit('newOrder', order);   // live push to manager
  res.json(order);
});

// Update order status (incoming → preparing → delivered / deleted)
app.patch('/api/orders/:id/status', async (req, res) => {
  const { id }    = req.params;
  const { status } = req.body;
  const order = await Order.findByIdAndUpdate(id, { status }, { new: true });
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  io.emit('orderUpdated', order);
  res.json(order);
});

// Root → customer view (same as you had)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ---------------- DASHBOARD APIs ----------------

// Sales totals and orders for day/week/month OR custom range
app.get('/api/dashboard/sales', async (req, res) => {
  let { period = 'day', date, from, to } = req.query;
  let start, end;

  if (from && to) {
    // custom range (IST)
    start = new Date(Date.parse(from + 'T00:00:00+05:30'));
    end   = new Date(Date.parse(to   + 'T23:59:59+05:30'));
  } else if (date) {
    // period-based from given date
    const base = new Date(Date.parse(date + 'T00:00:00+05:30'));
    start = base;
    end   = new Date(base);
    if (period === 'day')   end.setDate(start.getDate() + 1);
    else if (period === 'week')  end.setDate(start.getDate() + 7);
    else if (period === 'month') end.setMonth(start.getMonth() + 1);
  } else {
    // default: today in server local
    const today = new Date();
    start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    end   = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  }

  const agg = await Order.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end }, status: { $ne: 'deleted' } } },
    { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }
  ]);

  res.json({ total: agg[0]?.total || 0, count: agg[0]?.count || 0 });
});

// Most ordered dish (day or custom range, same params you were using)
app.get('/api/dashboard/topdish', async (req, res) => {
  let { date, from, to } = req.query;
  let match = { status: { $ne: 'deleted' } };

  if (from && to) {
    match.createdAt = {
      $gte: new Date(Date.parse(from + 'T00:00:00+05:30')),
      $lt:  new Date(Date.parse(to   + 'T23:59:59+05:30'))
    };
  } else if (date) {
    match.createdAt = {
      $gte: new Date(Date.parse(date + 'T00:00:00+05:30')),
      $lt:  new Date(Date.parse(date + 'T23:59:59+05:30'))
    };
  } else {
    const { start, end } = getISTDateBounds(new Date().toISOString().slice(0,10));
    match.createdAt = { $gte: start, $lt: end };
  }

  const agg = await Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    { $group: { _id: '$items.name', count: { $sum: '$items.qty' } } },
    { $sort: { count: -1 } },
    { $limit: 1 }
  ]);

  res.json(agg[0] || null);
});

// Repeat customers in any period, with optional name filter
app.get('/api/dashboard/repeatcustomers', async (req, res) => {
  let { month, from, to, name } = req.query;
  let match = { status: { $ne: 'deleted' } };

  if (from && to) {
    match.createdAt = {
      $gte: new Date(Date.parse(from + 'T00:00:00+05:30')),
      $lt:  new Date(Date.parse(to   + 'T23:59:59+05:30'))
    };
  } else if (month) {
    const s = new Date(month + '-01T00:00:00+05:30');
    const e = new Date(s); e.setMonth(s.getMonth() + 1);
    match.createdAt = { $gte: s, $lt: e };
  }

  if (name) {
    match.customerName = name;
  }

  const agg = await Order.aggregate([
    { $match: match },
    { $group: { _id: '$customerName', orders: { $sum: 1 } } },
    { $match: { orders: { $gte: 2 } } },
    { $sort: { orders: -1 } }
  ]);

  res.json(agg);
});

// Peak hour (IST), used by manager dashboard
app.get('/api/dashboard/peakhour', async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { start, end } = getISTDateBounds(date);

  const agg = await Order.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end }, status: { $ne: 'deleted' } } },
    { $group: { _id: { hour: { $hour: '$createdAt' } }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 }
  ]);

  // Manager.html expects peak.hour or "-"
  const doc = agg[0];
  if (!doc) return res.json({ hour: '-', count: 0 });
  res.json({ hour: doc._id.hour, count: doc.count });
});

// ---------------- SOCKET.IO ----------------
io.on('connection', (socket) => {
  console.log('🟢 Manager/Client connected to Socket.IO');
  socket.emit('connected', { status: 'connected' });
});

// ---------------- HEALTH CHECK ----------------
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ---------------- SERVER ----------------
server.listen(PORT, () => {
  console.log(`🚀 Titishya Fast Food Server running on http://localhost:${PORT}`);
  console.log('Open index.html and manager.html in browser');
});
