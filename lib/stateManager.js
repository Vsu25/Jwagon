const supabase = require('./supabase');

const stateMap = new Map(); // userId -> state object

async function loadState(userId) {
  if (stateMap.has(userId)) return stateMap.get(userId);
  
  if (supabase) {
    const { data, error } = await supabase
      .from('overlay_configs')
      .select('config')
      .eq('user_id', userId)
      .single();
      
    if (data && data.config) {
      stateMap.set(userId, data.config);
      return data.config;
    }
  }
  
  // Default state
  const defaultState = { elements: {} };
  stateMap.set(userId, defaultState);
  return defaultState;
}

async function getState(userId, path = null) {
  const state = await loadState(userId);
  if (!path) return state;
  
  return path.split('.').reduce((obj, key) => (obj && obj[key] !== 'undefined') ? obj[key] : undefined, state);
}

let undoEngine;
try {
  undoEngine = require('./undoEngine');
} catch (e) {
  undoEngine = { push: () => {} };
}

async function setState(userId, path, value, source = 'manual') {
  const state = await loadState(userId);
  
  const keys = path.split('.');
  let current = state;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  
  if (undoEngine && typeof undoEngine.push === 'function') {
    undoEngine.push(userId, { type: 'state:update', path, value, source });
  }
  
  // Lazy require to avoid circular dependency
  const { broadcast } = require('../server');
  broadcast({
    type: 'state:update',
    userId: userId,
    data: { path, value }
  }, [userId]);
  
  saveStateToDb(userId, state);
  
  return state;
}

const saveTimers = new Map();
function saveStateToDb(userId, state) {
  if (saveTimers.has(userId)) clearTimeout(saveTimers.get(userId));
  saveTimers.set(userId, setTimeout(async () => {
    if (supabase) {
      await supabase
        .from('overlay_configs')
        .upsert({ user_id: userId, config: state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    }
  }, 1000));
}

async function batchUpdate(userId, updates, source = 'manual') {
    const state = await loadState(userId);
    updates.forEach(update => {
        const keys = update.path.split('.');
        let current = state;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) current[keys[i]] = {};
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = update.value;
    });

    if (undoEngine && typeof undoEngine.push === 'function') {
        undoEngine.push(userId, { type: 'state:batch_update', updates, source });
    }

    const { broadcast } = require('../server');
    broadcast({
        type: 'state:batch_update',
        userId: userId,
        data: { updates }
    }, [userId]);

    saveStateToDb(userId, state);
    return state;
}

module.exports = { getState, setState, loadState, batchUpdate };
