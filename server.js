require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Auth cookie config (from agent.md)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-string-replace-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax'
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Set up Auth Routes
const { setupAuthRoutes } = require('./lib/auth');
setupAuthRoutes(app);

// Basic routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Auth Middleware wrapper
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.redirect('/login');
  next();
}

app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    userId: req.session.userId,
    kickUserId: req.session.kickUserId,
    role: req.session.role
  });
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/overlay/:userId', (req, res) => {
  // OBS Source, no auth required
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// Webhook routes
const { setupWebhookRoute } = require('./lib/kickWebhook');
setupWebhookRoute(app);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// WebSocket Hub
const clients = new Map(); // ws -> { userId, role, isAlive }

function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  // Parse query params for userId and role if joining as overlay or dashboard
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const userId = urlParams.get('userId');
  const role = urlParams.get('role') || 'viewer';
  
  if (userId) {
    clients.set(ws, { userId, role, isAlive: true });
    console.log(`Client connected: userId=${userId}, role=${role}`);
  } else {
    ws.close(1008, 'userId is required');
    return;
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // Example basic handler for incoming actions from dashboard UI
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        if (data.payload && data.payload.action) {
           const { handleCommand } = require('./lib/commandHandler');
           handleCommand(userId, data.payload);
        }
      }
    } catch (e) {
      console.error('WS message error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Client disconnected: userId=${userId}`);
  });
});

// Broadcast helper for specific users
function broadcast(messageObj, targetUserIds = null) {
  const messageStr = JSON.stringify(messageObj);
  wss.clients.forEach(ws => {
    const clientData = clients.get(ws);
    if (!clientData) return;
    
    if (ws.readyState === ws.OPEN) {
      if (!targetUserIds || targetUserIds.includes(clientData.userId)) {
        ws.send(messageStr);
      }
    }
  });
}

// WS Heartbeat interval
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

// Export broadcast for other modules
module.exports = { broadcast };
