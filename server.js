require('dotenv').config();
const express = require('express');
const session = require('cookie-session');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Trust proxy is required for secure cookies behind Vercel's load balancer
app.set('trust proxy', 1);

// Auth cookie config
const sessionMiddleware = session({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-string-replace-in-prod'],
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  sameSite: 'lax'
});
app.use(sessionMiddleware);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Set up Auth Routes
const { setupAuthRoutes } = require('./lib/auth');
setupAuthRoutes(app);

// ─── Supabase Realtime Broadcast ───
const supabase = require('./lib/supabase');

/**
 * Broadcast a message to a Supabase Realtime channel.
 * This replaces the old WebSocket broadcast() function.
 * Channel name format: overlay:{userId}
 */
async function broadcastRealtime(channelName, eventName, payload) {
  if (!supabase) return Promise.resolve();
  return new Promise((resolve) => {
    // Generate a unique client instance for this broadcast so we don't conflict with existing channels in a warm lambda
    const channel = supabase.channel(channelName + '-bcast-' + Date.now() + Math.floor(Math.random()*1000));
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.send({
            type: 'broadcast',
            event: eventName,
            payload: payload
          });
        } catch (e) {
          console.error('Realtime broadcast error:', e.message);
        } finally {
          supabase.removeChannel(channel);
          resolve();
        }
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        supabase.removeChannel(channel);
        resolve();
      }
    });

    // Timeout safety
    setTimeout(() => {
      supabase.removeChannel(channel);
      resolve();
    }, 2000);
  });
}

// Legacy-compatible broadcast wrapper used by lib modules
async async function broadcast(messageObj, targetUserIds = null) {
  if (!targetUserIds || targetUserIds.length === 0) return;
  const promises = targetUserIds.map(userId => {
    // Note: We use the exact channel name clients listen to (overlay:user-id)
    return broadcastRealtime(`overlay:${userId}`, messageObj.type, messageObj.data || {});
  });
  await Promise.allSettled(promises);
}

// ─── Gateway (Access Wall) ───
app.get('/gate', (req, res) => {
  if (req.session.gatePassed) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'gate.html'));
});

app.post('/api/gate/verify', (req, res) => {
  const pin = req.body.pin;
  const correctPin = process.env.GATEWAY_PIN;
  
  if (!correctPin) {
    req.session.gatePassed = true;
    return res.redirect('/login');
  }
  
  if (pin === correctPin) {
    req.session.gatePassed = true;
    return res.redirect('/login');
  }
  
  res.redirect('/gate?err=1');
});

function requireGate(req, res, next) {
  if (!process.env.GATEWAY_PIN) return next();
  if (req.session?.gatePassed) return next();
  return res.redirect('/gate');
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.redirect('/login');
  next();
}

// Basic routes
app.get('/', (req, res) => res.redirect('/gate'));

app.get('/login', requireGate, (req, res) => {
  if (req.session?.userId) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/api/auth/kick-gate', requireGate, (req, res) => {
  res.redirect('/api/auth/kick');
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    let username = 'Unknown';
    let avatar = '';
    if (supabase) {
      const { data } = await supabase
        .from('users')
        .select('kick_username, kick_avatar')
        .eq('id', req.session.userId)
        .single();
      if (data) {
        username = data.kick_username || 'Unknown';
        avatar = data.kick_avatar || '';
      }
    }
    res.json({
      userId: req.session.userId,
      kickUserId: req.session.kickUserId,
      kickUsername: username,
      kickAvatar: avatar,
      role: req.session.role
    });
  } catch (err) {
    res.json({
      userId: req.session.userId,
      kickUserId: req.session.kickUserId,
      kickUsername: 'Unknown',
      kickAvatar: '',
      role: req.session.role
    });
  }
});

// ─── Supabase Config for Frontend ───
app.get('/api/supabase-config', (req, res) => {
  res.json({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

app.get('/dashboard', requireGate, requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/overlay/:userId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// ─── Command API (replaces WebSocket messages) ───
app.post('/api/command', requireAuth, async (req, res) => {
  const { action, ...payload } = req.body;
  if (!action) return res.status(400).json({ error: 'Missing action' });
  
  // Determine target userId from session or payload
  const targetUserId = payload.targetUserId || req.session.userId;
  
  // Security: verify user has permission to control this target
  if (targetUserId !== req.session.userId) {
    // Check moderator assignment
    if (supabase) {
      const { data, error } = await supabase
        .from('moderator_assignments')
        .select('id')
        .eq('streamer_id', targetUserId)
        .eq('manager_id', req.session.userId)
        .single();
      
      if (!data || error) {
        return res.status(403).json({ error: 'Not authorized for this channel' });
      }
    } else {
      return res.status(403).json({ error: 'Not authorized' });
    }
  }
  
  try {
    const { handleCommand } = require('./lib/commandHandler');
    await handleCommand(targetUserId, { action, ...payload });
    res.json({ success: true });
  } catch (err) {
    console.error('Command error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── State API (initial load for dashboard/overlay) ───
app.get('/api/state/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const stateManager = require('./lib/stateManager');
    const countdown = require('./lib/countdown');
    const goals = require('./lib/goals');
    const roulette = require('./lib/roulette');
    
    const overlayState = await stateManager.getState(userId);
    const countdownState = countdown.getState(userId);
    const goalState = goals.getGoalState(userId) || await goals.initUser(userId);
    const rouletteState = await roulette.initUser(userId);
    
    res.json({
      overlay: overlayState || { elements: {} },
      countdown: countdownState || { running: false, currentMs: 3600000, endTime: null },
      goals: goalState || { currentCount: 0, list: [] },
      roulette: { slices: rouletteState?.slices || [] }
    });
  } catch (err) {
    console.error('State fetch error:', err);
    res.json({
      overlay: { elements: {} },
      countdown: { running: false, currentMs: 3600000, endTime: null },
      goals: { currentCount: 0, list: [] },
      roulette: { slices: [] }
    });
  }
});

// Webhook routes
const { setupWebhookRoute } = require('./lib/kickWebhook');
setupWebhookRoute(app);

const PORT = process.env.PORT || 3000;
if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

// Export app for Vercel, and attach broadcast for internal lib usage
module.exports = app;
module.exports.broadcast = broadcast;
