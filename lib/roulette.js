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

async function spin(userId) {
  const userState = await initUser(userId);
  if (userState.isSpinning || userState.slices.length === 0) return;
  
  userState.isSpinning = true;
  userState.result = null;
  
  const winnerIndex = Math.floor(Math.random() * userState.slices.length);
  const winner = userState.slices[winnerIndex];
  
  // 10 extra spins
  const fullRotations = 10 * 360;
  const sliceAngle = 360 / userState.slices.length;
  const targetAngle = fullRotations + (360 - (winnerIndex * sliceAngle)) - (sliceAngle / 2);

  // Send slices first to ensure overlay has them
  broadcast({
    type: 'roulette:update',
    userId,
    data: { slices: userState.slices }
  }, [userId]);

  broadcast({
    type: 'roulette:spin',
    userId,
    data: { targetAngle, duration: 5000 }
  }, [userId]);
  
  setTimeout(() => {
    userState.isSpinning = false;
    userState.result = winner.text;
    
    broadcast({
      type: 'roulette:result',
      userId,
      data: { result: winner.text }
    }, [userId]);
  }, 5000 + 500);
}

async function saveSlices(userId, slices) {
  const userState = await initUser(userId);
  userState.slices = slices;
  
  if (supabase) {
    // Placeholder hook for persistent db storage mapping
  }
  
  broadcast({
    type: 'roulette:update',
    userId,
    data: { slices }
  }, [userId]);
}

module.exports = { initUser, spin, saveSlices };
