const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketio(server);
const PORT = process.env.PORT || 3000;

// MongoDB Atlas connection string
const MONGO_URI = 'mongodb+srv://akofficial1905_db_user:FbqAuhCOkXLN0XH1@restaurantdata.kxozvbc.mongodb.net/?appName=RESTAURANTDATA';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Connection feedback
mongoose.connection.on('connected', () => {
  console.log('MongoDB connected!');
});
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

const orderSchema = new mongoose.Schema({
  orderType: String,
  customerName: String,
  mobile: String,
  tableNumber: String,
  address: String,
  items: Array,
  total: Number,
  status: { type: String, default: 'incoming' },
  createdAt: { type: Date, default: Date.now, index: true }
});
// TTL index: auto-delete after 3 months (7776000 seconds)
orderSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

const Order = mongoose.model('Order', orderSchema);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getToday(dateStr) {
  return dateStr || new Date().toISOString().slice(0, 10);
}

app.get('/menu.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/menu.json'));
});

// Get orders for a date (IST Timezone)
app.get('/api/orders', async (req, res) => {
  // --- CHANGE STARTS HERE ---
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(Date.now() + IST_OFFSET);
  const date = getToday(req.query.date || nowIST.toISOString().slice(0, 10));
  const start = new Date(Date.parse(date + 'T00:00:00+05:30'));
  const end = new Date(Date.parse(date + 'T23:59:59+05:30'));
  // --- CHANGE ENDS HERE ---
  const orders = await Order.find({
    createdAt: { $gte: start, $lte: end },
    status: { $ne: 'deleted' }
  });
  res.json(orders);
});

app.post('/api/orders', async (req, res) => {
  const { orderType, customerName, mobile, tableNumber, address, items } = req.body;
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const order = new Order({
    orderType, customerName, mobile, tableNumber, address,
    items, total
  });
  await order.save();
  io.emit('newOrder', order);
  res.json(order);
});

// Update status (preparing/delivered/deleted)
app.patch('/api/orders/:id/status', async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (order) {
    order.status = req.body.status;
    await order.save();
    io.emit('orderUpdated', order);
    res.json(order);
  } else {
    res.status(404).json({ error: 'Order not found' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log('Open index.html and manager.html in browser');
});

io.on('connection', (socket) => {
  // No special handling required
});

