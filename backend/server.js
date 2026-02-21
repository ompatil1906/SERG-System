const express = require('express');
const cors = require('cors');
require('dotenv').config();

const apiRoutes = require('./routes/api');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', apiRoutes);

// Health check
app.get('/', (req, res) => {
  res.send('SERG Backend is running');
});

const PORT = process.env.PORT || 5000;
// Explicitly bind to IPv4 — "0.0.0.0" resolves to IPv6 on macOS
// which blocks ESP32 (IPv4) from connecting
const HOST = "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log(`Server started on http://${addr.address}:${addr.port}`);
  console.log(`ESP32 should POST to: http://10.125.252.77:${addr.port}/api/device-data`);
});
