const undoEngine = require('./undoEngine');
const stateManager = require('./stateManager');
const coopSync = require('./coopSync');

// In-memory state per user (serverless: resets per cold start, but /api/state reloads)
const state = new Map();
const addHistory = new Map();

async function initUser(userId) {
  if (state.has(userId)) return state.get(userId);
  const userState = {
    running: false,
    currentMs: 3600000, // 1 hour default
    endTime: null,      // timestamp when timer reaches zero (set on start)
    config: {
      startTime: 3600000,
      timePerSub: 30000,
      timePerGiftedSub: 30000,
      timePerFollow: 0,
      timePerKicksGift: 15000,
      maxCap: 86400000,
      minFloor: 0,
      autoAddEnabled: true
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
    return;
  }

  // Co-op check
  const sessionId = coopSync.getActiveSession(userId);
  if (sessionId) {
    const session = await coopSync.loadSession(sessionId);
    const member = session.coop_members.find(m => m.user_id === userId);
    if (member && member.share_countdown) {
      session.shared_countdown.currentMs += ms;
      const newMs = session.shared_countdown.currentMs;
      
      const { broadcast } = require('../server');
      const members = await coopSync.getMembers(sessionId);
      for (const memberId of members) {
        await broadcast({
          type: 'countdown:update',
          userId: memberId,
          data: { currentMs: newMs, addedMs: ms, source }
        }, [memberId]);
      }
      return;
    }
  }

  userState.currentMs = Math.min(userState.config.maxCap, Math.max(userState.config.minFloor, userState.currentMs + ms));
  
  // If running, update endTime
  if (userState.running && userState.endTime) {
    userState.endTime += ms;
  }

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
  await broadcast({
    type: 'countdown:update',
    userId,
    data: {
      currentMs: userState.currentMs,
      endTime: userState.endTime,
      running: userState.running,
      addedMs: ms,
      source
    }
  }, [userId]);
}

async function undoLastAdd(userId) {
  const history = addHistory.get(userId);
  if (!history || history.length === 0) return false;
  
  const last = history.pop();
  const userState = await initUser(userId);
  userState.currentMs = Math.max(userState.config.minFloor, userState.currentMs - last.ms);
  
  if (userState.running && userState.endTime) {
    userState.endTime -= last.ms;
  }
  
  const { broadcast } = require('../server');
  await broadcast({
    type: 'countdown:update',
    userId,
    data: {
      currentMs: userState.currentMs,
      endTime: userState.endTime,
      running: userState.running,
      addedMs: -last.ms,
      source: 'undo'
    }
  }, [userId]);
  await broadcast({ type: 'countdown:undo', userId, data: { undoneMs: last.ms, source: last.source } }, [userId]);
  return true;
}

async function start(userId) {
  const userState = await initUser(userId);
  if (userState.running) return;
  userState.running = true;
  userState.endTime = Date.now() + userState.currentMs;
  
  const { broadcast } = require('../server');
  await broadcast({
    type: 'countdown:state',
    userId,
    data: {
      running: true,
      endTime: userState.endTime,
      currentMs: userState.currentMs
    }
  }, [userId]);
}

async function stop(userId) {
  const userState = await initUser(userId);
  
  // Calculate remaining time from endTime
  if (userState.running && userState.endTime) {
    userState.currentMs = Math.max(0, userState.endTime - Date.now());
  }
  
  userState.running = false;
  userState.endTime = null;
  
  const { broadcast } = require('../server');
  await broadcast({
    type: 'countdown:state',
    userId,
    data: {
      running: false,
      endTime: null,
      currentMs: userState.currentMs
    }
  }, [userId]);
}

async function reset(userId) {
  await stop(userId);
  const userState = await initUser(userId);
  userState.currentMs = userState.config.startTime;
  userState.endTime = null;
  if (addHistory.has(userId)) addHistory.set(userId, []);
  
  const { broadcast } = require('../server');
  await broadcast({
    type: 'countdown:update',
    userId,
    data: {
      currentMs: userState.currentMs,
      endTime: null,
      running: false,
      addedMs: 0
    }
  }, [userId]);
}

async function setStartTime(userId, ms) {
  const userState = await initUser(userId);
  userState.config.startTime = ms;
  userState.currentMs = ms;
  userState.endTime = null;
  userState.running = false;
  
  const { broadcast } = require('../server');
  await broadcast({
    type: 'countdown:update',
    userId,
    data: {
      currentMs: ms,
      endTime: null,
      running: false,
      addedMs: 0
    }
  }, [userId]);
}

async function updateConfig(userId, configUpdates) {
  const userState = await initUser(userId);
  Object.assign(userState.config, configUpdates);
  const { broadcast } = require('../server');
  await broadcast({ type: 'countdown:config', userId, data: { config: userState.config } }, [userId]);
}

function getConfig(userId) {
  return state.get(userId) ? state.get(userId).config : {
    startTime: 3600000, timePerSub: 30000, timePerGiftedSub: 30000, timePerFollow: 0, timePerKicksGift: 15000, maxCap: 86400000, minFloor: 0, autoAddEnabled: true
  };
}

function getState(userId) {
  const s = state.get(userId);
  if (!s) return null;
  
  // If running, compute currentMs from endTime for state snapshots
  if (s.running && s.endTime) {
    return {
      ...s,
      currentMs: Math.max(0, s.endTime - Date.now())
    };
  }
  return s;
}

module.exports = { initUser, addTime, undoLastAdd, start, stop, reset, setStartTime, updateConfig, getConfig, getState };
