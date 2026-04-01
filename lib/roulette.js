const stateManager = require('./stateManager');

/**
 * Initialize or Load roulette state from the database.
 */
async function initUser(userId) {
  const fullState = await stateManager.loadState(userId);
  if (!fullState.session) fullState.session = {};
  
  if (!fullState.session.roulette) {
    fullState.session.roulette = {
      isSpinning: false,
      spinEndTime: null,
      lastResult: null,
      slices: [
        { text: 'Eat Bean Boozled', color: '#ff3333' },
        { text: 'Gift 5 Subs', color: '#33ff33' },
        { text: '10 Pushups', color: '#3333ff' },
        { text: 'Drop Weapon', color: '#ffff33' }
      ]
    };
    await stateManager.setState(userId, 'session.roulette', fullState.session.roulette, 'init');
  }
  
  return fullState.session.roulette;
}

async function spin(userId, explicitlyProvidedSlices = null) {
  const userState = await initUser(userId);
  const slices = explicitlyProvidedSlices || userState.slices;
  
  if (userState.isSpinning || slices.length === 0) return;

  const winnerIndex = Math.floor(Math.random() * slices.length);
  const winner = slices[winnerIndex];
  
  const fullRotations = 20 * 360;
  const sliceAngle = 360 / slices.length;
  const targetAngle = fullRotations + (360 - (winnerIndex * sliceAngle)) - (sliceAngle / 2);
  const duration = 7000;
  const spinEndTime = Date.now() + duration;

  // Persist spin state
  await stateManager.batchUpdate(userId, [
    { path: 'session.roulette.isSpinning', value: true },
    { path: 'session.roulette.spinEndTime', value: spinEndTime },
    { path: 'session.roulette.lastResult', value: winner.text }
  ], 'spin');

  // Broadcast to Overlay
  const { broadcast } = require('../server');
  await broadcast({
    type: 'roulette:spin',
    userId,
    data: { 
      targetAngle, 
      duration, 
      slices,
      winner: winner.text // Overlay can handle the announcement at the end of its own animation
    }
  }, [userId]);

  // In Serverless (Vercel), we DON'T wait here. 
  // The overlay is the authority on the animation.
  // The next time the dashboard heartbeats, we check if spinEndTime has passed.
  return { winner: winner.text };
}

module.exports = {
  initUser,
  spin
};