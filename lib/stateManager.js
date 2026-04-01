const supabase = require('./supabase');

/**
 * Load the latest state from Supabase.
 * In a serverless env (Vercel), we cannot trust in-memory state.
 */
async function loadState(userId) {
  if (!supabase) return { elements: {}, session: {} };
  
  const { data, error } = await supabase
    .from('overlay_configs')
    .select('config')
    .eq('user_id', userId)
    .single();
    
  if (data && data.config) {
    // Ensure session object exists
    if (!data.config.session) data.config.session = {};
    return data.config;
  }
  
  // Default fallback state
  return { elements: {}, session: {} };
}

async function getState(userId, path = null) {
  const state = await loadState(userId);
  if (!path) return state;
  
  return path.split('.').reduce((obj, key) => (obj && typeof obj[key] !== 'undefined') ? obj[key] : undefined, state);
}

let undoEngine;
try {
  undoEngine = require('./undoEngine');
} catch (e) {
  undoEngine = { push: () => {} };
}

/**
 * Set state and persist directly to DB.
 * In Vercel, we must AWAIT the database write or the process might end before saving.
 */
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
  
  // ─── BROADCAST & PERSIST ───
  // Note: We still broadcast for instant UI feel, but the DB is the authority.
  const { broadcast } = require('../server');
  await broadcast({
    type: 'state:update',
    userId: userId,
    data: { path, value }
  }, [userId]);
  
  // Mandatory immediate save for serverless reliability
  await saveStateInternal(userId, state);
  
  return state;
}

async function saveStateInternal(userId, state) {
  if (supabase) {
    await supabase
      .from('overlay_configs')
      .upsert({ user_id: userId, config: state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }
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
    await broadcast({
        type: 'state:batch_update',
        userId: userId,
        data: { updates }
    }, [userId]);

    await saveStateInternal(userId, state);
    return state;
}

module.exports = { getState, setState, loadState, batchUpdate };
