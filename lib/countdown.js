const undoEngine = require('./undoEngine');
const stateManager = require('./stateManager');
const coopSync = require('./coopSync');

const timers = new Map(); // userId -> interval
const state = new Map();
const addHistory = new Map(); // userId -> array of { ms, source, timestamp }

async function initUser(userId) {
  if (state.has(userId)) return state.get(userId);
  const userState = {
    running: false,
    currentMs: 3600000, // 1 hour
    config: {
      startTime: 3600000,
      timePerSub: 30000, // 30s
      timePerGiftedSub: 30000, // 30s
      timePerFollow: 0,
      timePerKicksGift: 15000, // 15s
      maxCap: 86400000, // 24h
      minFloor: 0,
      autoAddEnabled: true // Toggle for auto-add from subs
    }
  };
  state.set(userId, userState);
  if (!addHistory.has(userId)) addHistory.set(userId, []);
  return userState;
}

async function addTime(userId, ms, source, undoable = true) {
  const userState = await initUser(userId);

  // Check if auto-add is disabled for subscription sources
  if (!userState.config.autoAddEnabled && (source === 'new-sub' || source === 'gifted-sub' || source === 'follow' || source === 'kicks')) {
    return; // Auto-add disabled, skip
  }

  const sessionId = coopSync.getActiveSession(userId);
  if (sessionId) {
     const session = await coopSync.loadSession(sessionId);
     const member = session.coop_members.find(m => m.user_id === userId);
     if (member && member.share_countdown) {
         session.shared_countdown.currentMs += ms;
         const newMs = session.shared_countdown.currentMs;
         
         const { broadcast } = require('../server');
         const members = await coopSync.getMembers(sessionId);
         members.forEach(memberId => {
             broadcast({
                 type: 'countdown:update',
                 userId: memberId,
                 data: { currentMs: newMs, addedMs: ms, source }
             }, [memberId]);
         });
         return;
     }
  }

  const old = userState.currentMs;
  userState.currentMs = Math.min(userState.config.maxCap, Math.max(userState.config.minFloor, userState.currentMs + ms));

  // Track add history for undo
  if (!addHistory.has(userId)) addHistory.set(userId, []);
  addHistory.get(userId).push({ ms, source, timestamp: Date.now() });
  
  if (ms !== 0 && undoable) {
    undoEngine.push(userId, {
      type: 'countdown:add',
      forward_data: { ms },
      reverse_data: { ms: -ms },
      source
    });
  }
  
  const { broadcast } = require('../server');
  broadcast({ type: 'countdown:update', userId, data: { currentMs: userState.currentMs, addedMs: ms, source } }, [userId]);
}

async function undoLastAdd(userId) {
  const history = addHistory.get(userId);
  if (!history || history.length === 0) return false;
  
  const last = history.pop();
  const userState = await initUser(userId);
  userState.currentMs = Math.max(userState.config.minFloor, userState.currentMs - last.ms);
  
  const { broadcast } = require('../server');
  broadcast({ type: 'countdown:update', userId, data: { currentMs: userState.currentMs, addedMs: -last.ms, source: 'undo' } }, [userId]);
  broadcast({ type: 'countdown:undo', userId, data: { undoneMs: last.ms, source: last.source } }, [userId]);
  return true;
}

async function start(userId) {
  const userState = await initUser(userId);
  if (userState.running) return;
  userState.running = true;
  
  const { broadcast } = require('../server');
  broadcast({ type: 'countdown:state', userId, data: { running: true } }, [userId]);
  
  timers.set(userId, setInterval(async () => {
    if (userState.currentMs <= 0) {
      stop(userId);
      broadcast({ type: 'countdown:zero', userId, data: {} }, [userId]);
      return;
    }
    userState.currentMs -= 1000;
    broadcast({ type: 'countdown:tick', userId, data: { currentMs: userState.currentMs, addedMs: 0 } }, [userId]);
  }, 1000));
}

async function stop(userId) {
  const userState = await initUser(userId);
  userState.running = false;
  if (timers.has(userId)) {
    clearInterval(timers.get(userId));
    timers.delete(userId);
  }
  const { broadcast } = require('../server');
  broadcast({ type: 'countdown:state', userId, data: { running: false } }, [userId]);
}

async function reset(userId) {
  stop(userId);
  const userState = await initUser(userId);
  userState.currentMs = userState.config.startTime;
  if (addHistory.has(userId)) addHistory.set(userId, []);
  const { broadcast } = require('../server');
  broadcast({ type: 'countdown:update', userId, data: { currentMs: userState.currentMs, addedMs: 0 } }, [userId]);
}

async function setStartTime(userId, ms) {
  const userState = await initUser(userId);
  userState.config.startTime = ms;
  userState.currentMs = ms;
  const { broadcast } = require('../server');
  broadcast({ type: 'countdown:update', userId, data: { currentMs: ms, addedMs: 0 } }, [userId]);
}

async function updateConfig(userId, configUpdates) {
  const userState = await initUser(userId);
  Object.assign(userState.config, configUpdates);
  const { broadcast } = require('../server');
  broadcast({ type: 'countdown:config', userId, data: { config: userState.config } }, [userId]);
}

function getConfig(userId) {
  return state.get(userId) ? state.get(userId).config : {
    startTime: 3600000, timePerSub: 30000, timePerGiftedSub: 30000, timePerFollow: 0, timePerKicksGift: 15000, maxCap: 86400000, minFloor: 0, autoAddEnabled: true
  };
}

function getState(userId) {
  return state.get(userId) || null;
}

module.exports = { initUser, addTime, undoLastAdd, start, stop, reset, setStartTime, updateConfig, getConfig, getState };
