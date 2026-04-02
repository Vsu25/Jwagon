const { broadcast } = require('../server');
const supabase = require('./supabase');

const state = new Map();

async function initUser(userId) {
  if (state.has(userId)) return state.get(userId);
  const userState = {
    isSpinning: false,
    slices: [
      { text: 'Eat Bean Boozled', color: '#ff3333' },
      { text: 'Gift 5 Subs', color: '#33ff33' },
      { text: '10 Pushups', color: '#3333ff' },
      { text: 'Drop Weapon', color: '#ffff33' }
    ],
    result: null
  };
  state.set(userId, userState);
  return userState;
}

async function spin(userId, explicitlyProvidedSlices = null) {
  const userState = await initUser(userId);
  if (explicitlyProvidedSlices) userState.slices = explicitlyProvidedSlices;
  if (userState.isSpinning || userState.slices.length === 0) return;
  
  userState.isSpinning = true;
  userState.result = null;
  
  const winnerIndex = Math.floor(Math.random() * userState.slices.length);
  const winner = userState.slices[winnerIndex];
  
  // 20 extra full spins for dramatic effect
  const fullRotations = 20 * 360;
  const sliceAngle = 360 / userState.slices.length;
  const targetAngle = fullRotations + (360 - (winnerIndex * sliceAngle)) - (sliceAngle / 2);

  // Send slices first to ensure overlay has them
  await broadcast({
    type: 'roulette:update',
    userId,
    data: { slices: userState.slices }
  }, [userId]);

  userState.isSpinning = false;
  userState.result = winner.text;

  await broadcast({
    type: 'roulette:spin',
    userId,
    data: { 
      targetAngle, 
      duration: 7000,
      result: winner.text,
      action: winner.action || winner.text
    }
  }, [userId]);
  
  return Promise.resolve();
}

async function saveSlices(userId, slices) {
  const userState = await initUser(userId);
  userState.slices = slices;
  
  await broadcast({
    type: 'roulette:update',
    userId,
    data: { slices }
  }, [userId]);
}

module.exports = { initUser, spin, saveSlices };