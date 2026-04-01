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
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dev-secret-string-replace-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax'
  }
});
app.use(sessionMiddleware);

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

const supabase = require('./lib/supabase');

server.on('upgrade', (request, socket, head) => {
  sessionMiddleware(request, {}, () => {
    if (!request.session.userId && !request.url.includes('/overlay/')) {
      // Overlays don't need sessions, but dashboards do
      // However, we'll allow the upgrade and handle the check in the connection
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
});

wss.on('connection', async (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const targetUserId = urlParams.get('userId');
  const role = urlParams.get('role') || 'viewer';
  
  // Security check:
  // 1. If role is 'overlay', we allow connection (it's public/read-only)
  // 2. If role is 'streamer' (dashboard), we MUST verify the session
  
  let authorized = false;
  if (role === 'viewer') {
    authorized = true; // Overlay is public
  } else if (req.session && req.session.userId) {
    if (req.session.userId === targetUserId) {
      authorized = true; // Controlling own channel
    } else {
      // Check if user is a moderator for this targetUserId
      const { data, error } = await supabase
        .from('moderator_assignments')
        .select('id')
        .eq('streamer_id', targetUserId)
        .eq('manager_id', req.session.userId)
        .single();
      
      if (data && !error) {
        authorized = true; // Authorized moderator
        console.log(`Moderator ${req.session.userId} authorized for streamer ${targetUserId}`);
      }
    }
  }

  if (!targetUserId || !authorized) {
    console.warn(`Unauthorized WS connection attempt: sessionUser=${req.session?.userId}, target=${targetUserId}, role=${role}`);
    ws.close(1008, 'Unauthorized');
    return;
  }

  clients.set(ws, { userId: targetUserId, role, isAlive: true });
  console.log(`Client connected: userId=${targetUserId}, role=${role} (Auth: ${req.session?.userId || 'Public'})`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        if (data.payload && data.payload.action) {
           const { handleCommand } = require('./lib/commandHandler');
           handleCommand(targetUserId, data.payload);
        }
      }
    } catch (e) {
      console.error('WS message error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Client disconnected: userId=${targetUserId}`);
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
