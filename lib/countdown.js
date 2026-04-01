const { broadcast } = require('../server');
const undoEngine = require('./undoEngine');
const stateManager = require('./stateManager');

const timers = new Map(); // userId -> interval
const state = new Map(); 

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
      minFloor: 0
    }
  };
  state.set(userId, userState);
  return userState;
}

async function addTime(userId, ms, source, undoable = true) {
  const userState = await initUser(userId);
  const oldMs = userState.currentMs;
  
  userState.currentMs = Math.min(userState.currentMs + ms, userState.config.maxCap);
  const added = userState.currentMs - oldMs;
  
  if (added !== 0 && undoable) {
    undoEngine.push(userId, {
      type: 'countdown:add',
      forward_data: { ms: added },
      reverse_data: { ms: -added },
      source
    });
  }
  
  broadcast({
    type: 'countdown:update',
    userId,
    data: { currentMs: userState.currentMs, addedMs: added, source }
  }, [userId]);
}

async function start(userId) {
  const userState = await initUser(userId);
  if (userState.running) return;
  userState.running = true;
  
  const tick = () => {
    if (userState.currentMs <= userState.config.minFloor) {
      userState.currentMs = userState.config.minFloor;
      stop(userId);
      broadcast({ type: 'countdown:zero', userId }, [userId]);
      return;
    }
    userState.currentMs -= 1000;
    // Broadcast tick
    broadcast({ type: 'countdown:tick', userId, data: { currentMs: userState.currentMs } }, [userId]);
  };
  
  timers.set(userId, setInterval(tick, 1000));
  broadcast({ type: 'countdown:state', userId, data: { running: true } }, [userId]);
}

function stop(userId) {
  if (timers.has(userId)) {
    clearInterval(timers.get(userId));
    timers.delete(userId);
  }
  if (state.has(userId)) state.get(userId).running = false;
  broadcast({ type: 'countdown:state', userId, data: { running: false } }, [userId]);
}

async function reset(userId) {
  stop(userId);
  const userState = await initUser(userId);
  userState.currentMs = userState.config.startTime;
  broadcast({ type: 'countdown:update', userId, data: { currentMs: userState.currentMs, addedMs: 0 } }, [userId]);
}

function getConfig(userId) {
  return state.get(userId) ? state.get(userId).config : {
    startTime: 3600000, timePerSub: 30000, timePerGiftedSub: 30000, timePerFollow: 0, timePerKicksGift: 15000, maxCap: 86400000, minFloor: 0
  };
}

module.exports = { initUser, addTime, start, stop, reset, getConfig };
