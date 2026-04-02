const undoEngine = require('./undoEngine');
const alertQueue = require('./alertQueue');
const coopSync = require('./coopSync');
const supabase = require('./supabase');

const state = new Map();
const mockTracking = new Map(); // userId -> total mock increments

async function initUser(userId) {
  if (state.has(userId)) return state.get(userId);
  
  // Try to load from Supabase first
  if (supabase) {
    try {
      const { data } = await supabase
        .from('overlay_configs')
        .select('config')
        .eq('user_id', userId)
        .single();
      
      if (data && data.config && data.config.goals) {
        const saved = data.config.goals;
        const userState = {
          enabled: true,
          currentCount: saved.currentCount || 0,
          list: saved.list || [],
          config: saved.config || {
            countMode: 'cumulative',
            giftMultiplier: 1,
            showCompleted: true,
            autoCelebrate: true
          }
        };
        state.set(userId, userState);
        if (!mockTracking.has(userId)) mockTracking.set(userId, 0);
        return userState;
      }
    } catch (e) {
      // Fall through to defaults
    }
  }
  
  const userState = {
    enabled: true,
    currentCount: 0,
    list: [
      { id: '1', name: 'Play Horror Game', type: 'subs', targetCount: 10, reward: '' },
      { id: '2', name: 'Dye Hair Blue', type: 'subs', targetCount: 50, reward: '' }
    ],
    config: {
      countMode: 'cumulative',
      giftMultiplier: 1,
      showCompleted: true,
      autoCelebrate: true
    }
  };
  state.set(userId, userState);
  if (!mockTracking.has(userId)) mockTracking.set(userId, 0);
  return userState;
}

// Persist goals to Supabase (debounced)
function persistGoals(userId) {
  if (!supabase) return;
  const userState = state.get(userId);
  if (!userState) return;
  
  supabase.from('overlay_configs')
    .select('config')
    .eq('user_id', userId)
    .single()
    .then(({ data: existing }) => {
      const config = (existing && existing.config) ? existing.config : {};
      config.goals = {
        currentCount: userState.currentCount,
        list: userState.list,
        config: userState.config
      };
      
      return supabase.from('overlay_configs').upsert({ user_id: userId, config, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    })
    .catch(e => console.error('Failed to persist goals:', e.message));
}

async function increment(userId, amount, source, undoable = true) {
  // Track mock increments separately
  const isMock = source && source.startsWith('mock-');
  if (isMock) {
    if (!mockTracking.has(userId)) mockTracking.set(userId, 0);
    mockTracking.set(userId, mockTracking.get(userId) + amount);
  }

  const sessionId = coopSync.getActiveSession(userId);
  if (sessionId) {
     const session = await coopSync.loadSession(sessionId);
     const member = session.coop_members.find(m => m.user_id === userId);
     if (member && member.share_goals) {
         const old = session.shared_goals.currentCount;
         session.shared_goals.currentCount += amount;
         const newCount = session.shared_goals.currentCount;
         
         const { broadcast } = require('../server');
         const members = await coopSync.getMembers(sessionId);
         for (const memberId of members) {
             await broadcast({
                type: 'goal:update',
                userId: memberId,
                data: { currentCount: newCount }
             }, [memberId]);
         }
         
         for (const goal of session.shared_goals.list) {
             if (old < goal.targetCount && newCount >= goal.targetCount) {
                  for (const memberId of members) {
                      if (memberId === userId) {
                          if (session.shared_goals.config?.autoCelebrate !== false) {
                              alertQueue.enqueue(memberId, 'goal.reached', { goalName: goal.name });
                          }
                          await broadcast({ type: 'goal:reached', userId: memberId, data: { goalName: goal.name } }, [memberId]);
                      } else {
                          await broadcast({ type: 'coop:notification', userId: memberId, data: { message: `Goal '${goal.name}' reached! (via Partner's viewers)` } }, [memberId]);
                      }
                  }
             }
         }
         return; // Processed via coop, skip isolated loop
     }
  }

  const userState = await initUser(userId);
  const old = userState.currentCount;
  userState.currentCount += amount;
  
  if (amount !== 0 && undoable) {
    undoEngine.push(userId, {
      type: 'goals:add',
      forward_data: { amount },
      reverse_data: { amount: -amount },
      source
    });
  }
  
  const { broadcast } = require('../server');
  await broadcast({
    type: 'goal:update',
    userId,
    data: { currentCount: userState.currentCount }
  }, [userId]);

  await checkCompletion(userId, old, userState.currentCount, userState);
  
  // Persist to DB
  persistGoals(userId);
}

async function checkCompletion(userId, oldCount, newCount, userState) {
  if (!userState.list || userState.list.length === 0) return;
  const { broadcast } = require('../server');
  
  for (const goal of userState.list) {
    if (oldCount < goal.targetCount && newCount >= goal.targetCount) {
      if (userState.config.autoCelebrate) {
        alertQueue.enqueue(userId, 'goal.reached', { goalName: goal.name });
      }
      await broadcast({ type: 'goal:reached', userId, data: { goalName: goal.name, source: undefined } }, [userId]);
    }
  }
}

async function setGoals(userId, goalsList) {
    const userState = await initUser(userId);
    userState.list = goalsList;
    const { broadcast } = require('../server');
    await broadcast({ type: 'goal:list', userId, data: { goals: goalsList } }, [userId]);
    
    // Persist to DB
    persistGoals(userId);
}

async function manualIncrement(userId, amount) {
  await increment(userId, amount, 'manual', true);
}

async function revertMocks(userId, amount, overrideCount) {
  const mockAmount = amount || mockTracking.get(userId) || 0;
  if (mockAmount === 0) return 0;
  
  const userState = await initUser(userId);
  const old = userState.currentCount;
  userState.currentCount = overrideCount !== undefined ? overrideCount : Math.max(0, userState.currentCount - mockAmount);
  mockTracking.set(userId, 0);
  
  const { broadcast } = require('../server');
  await broadcast({
    type: 'goal:update',
    userId,
    data: { currentCount: userState.currentCount }
  }, [userId]);
  
  await broadcast({
    type: 'goal:mock_reverted',
    userId,
    data: { revertedAmount: mockAmount, newCount: userState.currentCount }
  }, [userId]);
  
  // Persist to DB
  persistGoals(userId);
  
  return mockAmount;
}

function getMockCount(userId) {
  return mockTracking.get(userId) || 0;
}

function getGoalState(userId) {
  return state.get(userId) || null;
}

module.exports = { initUser, increment, setGoals, manualIncrement, revertMocks, getMockCount, getGoalState };
