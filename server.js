// server.js
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let orders = []; // [{id, type, customerName, mobile, tableNumber, address, items, total, status, createdAt, orderType}]

function getToday(dateStr) {
  return dateStr || new Date().toISOString().slice(0, 10);
}

app.get('/menu.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/menu.json'));
});

// Get orders for a date
app.get('/api/orders', (req, res) => {
  const date = getToday(req.query.date);
  res.json(
    orders.filter(
      o => o.createdAt.slice(0, 10) === date && o.status !== 'deleted'
    )
  );
});

app.post('/api/orders', (req, res) => {
  const id = Date.now().toString();
  const { orderType, customerName, mobile, tableNumber, address, items } = req.body;
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const order = {
    id, orderType, customerName, mobile, tableNumber, address,
    items, total,
    status: 'incoming',
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  io.emit('newOrder', order);
  res.json(order);
});

// Update status (preparing/delivered/deleted)
app.patch('/api/orders/:id/status', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (order) {
    order.status = req.body.status;
    io.emit('orderUpdated', order);
    res.json(order);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000/');
  console.log('Open index.html and manager.html in browser');
});

io.on('connection', (socket) => {
  // No special handling required
});

