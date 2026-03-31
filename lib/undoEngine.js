const crypto = require('crypto');
const supabase = require('./supabase');

const history = new Map(); // userId -> array of actions (max 100)

async function push(userId, action) {
  if (!history.has(userId)) history.set(userId, []);
  const stack = history.get(userId);
  
  const id = crypto.randomUUID();
  const entry = {
    id,
    type: action.type || 'unknown',
    forward_data: action.forward_data || {},
    reverse_data: action.reverse_data || {},
    source: action.source || 'manual',
    reverted: false,
    timestamp: Date.now()
  };
  
  stack.push(entry);
  if (stack.length > 100) stack.shift(); // retain max 100
  
  if (supabase) {
    supabase.from('undo_history').insert([{
      id,
      user_id: userId,
      action_type: entry.type,
      forward_data: entry.forward_data,
      reverse_data: entry.reverse_data
    }]).then(({error}) => { if (error) console.error("Undo DB Insert Error:", error.message); });
  }

  // Lazy load WS broadcast
  const { broadcast } = require('../server');
  broadcast({
    type: 'undo:update',
    userId,
    data: { history: stack }
  }, [userId]);
}

async function pop(userId) {
  const stack = history.get(userId);
  if (!stack || stack.length === 0) return null;

  for (let i = stack.length - 1; i >= 0; i--) {
      if (!stack[i].reverted) {
          return await revert(userId, stack[i].id);
      }
  }
  return null;
}

async function revert(userId, actionId) {
  const stack = history.get(userId);
  if (!stack) return false;
  
  const action = stack.find(a => a.id === actionId);
  if (!action || action.reverted) return false;

  // Placeholder -> In future phase, call stateManager.setState with reverse_data
  action.reverted = true;

  if (supabase) {
      supabase.from('undo_history')
        .update({ reverted: true })
        .eq('id', actionId)
        .then(({error}) => { if(error) console.error("Undo DB Update Error:", error.message); });
  }

  const { broadcast } = require('../server');
  broadcast({
      type: 'undo:update',
      userId,
      data: { history: stack }
  }, [userId]);

  return true;
}

module.exports = { push, pop, revert };
