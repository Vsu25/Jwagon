const undoEngine = require('./undoEngine');
const alertQueue = require('./alertQueue');
const coopSync = require('./coopSync');

const state = new Map();

async function initUser(userId) {
  if (state.has(userId)) return state.get(userId);
  const userState = {
    enabled: true,
    currentCount: 0,
    list: [
      { id: '1', name: 'Play Horror Game', targetCount: 10, reward: '' },
      { id: '2', name: 'Dye Hair Blue', targetCount: 50, reward: '' }
    ],
    config: {
      countMode: 'cumulative',
      giftMultiplier: 1,
      showCompleted: true,
      autoCelebrate: true
    }
  };
  state.set(userId, userState);
  return userState;
}

async function increment(userId, amount, source, undoable = true) {
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
         members.forEach(memberId => {
             broadcast({
                type: 'goal:update',
                userId: memberId,
                data: { currentCount: newCount }
             }, [memberId]);
         });
         
         for (const goal of session.shared_goals.list) {
             if (old < goal.targetCount && newCount >= goal.targetCount) {
                  members.forEach(memberId => {
                      if (memberId === userId) {
                          if (session.shared_goals.config?.autoCelebrate !== false) {
                              alertQueue.enqueue(memberId, 'goal.reached', { goalName: goal.name });
                          }
                          broadcast({ type: 'goal:reached', userId: memberId, data: { goalName: goal.name } }, [memberId]);
                      } else {
                          broadcast({ type: 'coop:notification', userId: memberId, data: { message: `Goal '${goal.name}' reached! (via Partner's viewers)` } }, [memberId]);
                      }
                  });
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
  broadcast({
    type: 'goal:update',
    userId,
    data: { currentCount: userState.currentCount }
  }, [userId]);

  checkCompletion(userId, old, userState.currentCount, userState);
}

function checkCompletion(userId, oldCount, newCount, userState) {
  if (!userState.list || userState.list.length === 0) return;
  const { broadcast } = require('../server');
  
  for (const goal of userState.list) {
    if (oldCount < goal.targetCount && newCount >= goal.targetCount) {
      if (userState.config.autoCelebrate) {
        alertQueue.enqueue(userId, 'goal.reached', { goalName: goal.name });
      }
      broadcast({ type: 'goal:reached', userId, data: { goalName: goal.name, source: undefined } }, [userId]);
    }
  }
}

async function setGoals(userId, goalsList) {
    const userState = await initUser(userId);
    userState.list = goalsList;
}

module.exports = { initUser, increment, setGoals };
