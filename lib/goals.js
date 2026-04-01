const stateManager = require('./stateManager');
const alertQueue = require('./alertQueue');

/**
 * Initialize or Load goals state from the database.
 */
async function initUser(userId) {
  const fullState = await stateManager.loadState(userId);
  if (!fullState.session) fullState.session = {};
  
  if (!fullState.session.goals) {
    fullState.session.goals = {
      enabled: true,
      currentCount: 0,
      mockTracking: 0,
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
    await stateManager.setState(userId, 'session.goals', fullState.session.goals, 'init');
  }
  
  return fullState.session.goals;
}

function getGoalState(userId) {
  return null; // Force callers to use async initUser or stateManager
}

async function increment(userId, amount, source, undoable = true) {
  const userState = await initUser(userId);
  const isMock = source && source.startsWith('mock-');
  
  let newCount = userState.currentCount + amount;
  let newMockTracking = userState.mockTracking || 0;
  
  if (isMock) {
    newMockTracking += amount;
  }

  // Persist
  await stateManager.batchUpdate(userId, [
    { path: 'session.goals.currentCount', value: newCount },
    { path: 'session.goals.mockTracking', value: newMockTracking }
  ], source);

  // Broadcast
  const { broadcast } = require('../server');
  await broadcast({
    type: 'goal:update',
    userId,
    data: { 
      currentCount: newCount, 
      added: amount, 
      source,
      isMock
    }
  }, [userId]);

  // Check for milestones
  const milestones = userState.list.filter(g => g.targetCount <= newCount && g.targetCount > (newCount - amount));
  if (milestones.length > 0 && userState.config.autoCelebrate) {
    for (const m of milestones) {
      await alertQueue.push(userId, {
        type: 'goal_completed',
        title: 'Goal Reached!',
        message: m.name,
        reward: m.reward
      });
    }
  }
}

async function revertMockIncr(userId) {
  const userState = await initUser(userId);
  const amount = userState.mockTracking || 0;
  if (amount <= 0) return;

  const newCount = Math.max(0, userState.currentCount - amount);
  
  await stateManager.batchUpdate(userId, [
    { path: 'session.goals.currentCount', value: newCount },
    { path: 'session.goals.mockTracking', value: 0 }
  ], 'revert_mock');

  const { broadcast } = require('../server');
  await broadcast({
    type: 'goal:mock_reverted',
    userId,
    data: { newCount, revertedAmount: amount }
  }, [userId]);
}

async function updateGoals(userId, newList) {
  await stateManager.setState(userId, 'session.goals.list', newList, 'manual');
}

async function setProgress(userId, progress) {
  await stateManager.setState(userId, 'session.goals.currentCount', progress, 'manual');
  
  const { broadcast } = require('../server');
  await broadcast({
    type: 'goal:update',
    userId,
    data: { currentCount: progress, source: 'manual' }
  }, [userId]);
}

module.exports = {
  initUser,
  getGoalState,
  increment,
  revertMockIncr,
  updateGoals,
  setProgress
};
