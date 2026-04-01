const stateManager = require('./stateManager');
const coopSync = require('./coopSync');

/**
 * Initialize or Load user state from the database.
 */
async function initUser(userId) {
  const fullState = await stateManager.loadState(userId);
  if (!fullState.session) fullState.session = {};
  
  // If countdown session doesn't exist, create it with defaults
  if (!fullState.session.countdown) {
    fullState.session.countdown = {
      running: false,
      currentMs: 3600000, // 1 hour default
      endTime: null,
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
    // Save defaults immediately
    await stateManager.setState(userId, 'session.countdown', fullState.session.countdown, 'init');
  }
  
  return fullState.session.countdown;
}

function getState(userId) {
  // Since we are in a serverless environment, we often fetch fresh state 
  // via initUser or loadState. This wrapper is for convenience.
  // Note: We intentionally don't make this 'async' to keep it compatible with legacy callers,
  // but better to use 'await initUser(userId)' for certainty.
  return null; // Force callers to use async initUser or stateManager directly
}

async function addTime(userId, ms, source, undoable = true) {
  const userState = await initUser(userId);

  if (!userState.config.autoAddEnabled && (source === 'new-sub' || source === 'gifted-sub' || source === 'follow' || source === 'kicks')) {
    return;
  }

  // Handle Co-op
  const sessionId = coopSync.getActiveSession(userId);
  if (sessionId) {
    // ... Co-op logic remains similar but should ideally use DB too
    // For now, let's keep it simple and focus on single-user stability
  }

  const newMs = Math.max(userState.minFloor || 0, Math.min(userState.config.maxCap || 86400000, userState.currentMs + ms));
  
  // Calculate new endTime if running
  let newEndTime = userState.endTime;
  if (userState.running && userState.endTime) {
    newEndTime = userState.endTime + ms;
  }

  // Persist to DB
  await stateManager.batchUpdate(userId, [
    { path: 'session.countdown.currentMs', value: newMs },
    { path: 'session.countdown.endTime', value: newEndTime }
  ], source);

  const { broadcast } = require('../server');
  await broadcast({
    type: 'countdown:update',
    userId,
    data: { 
      currentMs: newMs, 
      addedMs: ms, 
      source,
      endTime: newEndTime,
      running: userState.running
    }
  }, [userId]);
}

async function start(userId) {
  const userState = await initUser(userId);
  if (userState.running) return;

  const endTime = Date.now() + userState.currentMs;
  
  await stateManager.batchUpdate(userId, [
    { path: 'session.countdown.running', value: true },
    { path: 'session.countdown.endTime', value: endTime }
  ], 'command');

  const { broadcast } = require('../server');
  await broadcast({
    type: 'countdown:state',
    userId,
    data: {
      running: true,
      endTime: endTime,
      currentMs: userState.currentMs
    }
  }, [userId]);
}

async function stop(userId) {
  const userState = await initUser(userId);
  if (!userState.running) return;

  const remainingMs = Math.max(0, userState.endTime - Date.now());

  await stateManager.batchUpdate(userId, [
    { path: 'session.countdown.running', value: false },
    { path: 'session.countdown.endTime', value: null },
    { path: 'session.countdown.currentMs', value: remainingMs }
  ], 'command');

  const { broadcast } = require('../server');
  await broadcast({
    type: 'countdown:state',
    userId,
    data: {
      running: false,
      endTime: null,
      currentMs: remainingMs
    }
  }, [userId]);
}

async function setTime(userId, ms) {
  await stateManager.batchUpdate(userId, [
    { path: 'session.countdown.currentMs', value: ms },
    { path: 'session.countdown.endTime', value: null },
    { path: 'session.countdown.running', value: false }
  ], 'command');
  
  const { broadcast } = require('../server');
  await broadcast({
    type: 'countdown:state',
    userId,
    data: {
      running: false,
      endTime: null,
      currentMs: ms
    }
  }, [userId]);
}

async function updateConfig(userId, newConfig) {
  await stateManager.setState(userId, 'session.countdown.config', newConfig, 'config_update');
}

module.exports = {
  initUser,
  getState,
  start,
  stop,
  addTime,
  setTime,
  updateConfig
};
