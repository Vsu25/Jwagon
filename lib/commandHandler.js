const countdown = require('./countdown');
const goals = require('./goals');
const coopSync = require('./coopSync');
const roulette = require('./roulette');
const stateManager = require('./stateManager');

async function handleCommand(userId, payload) {
  try {
     switch (payload.action) {
         case 'countdown_start':
             countdown.start(userId);
             break;
         case 'countdown_stop':
             countdown.stop(userId);
             break;
         case 'countdown_add':
             countdown.addTime(userId, payload.ms, 'manual');
             break;
         case 'toggle':
             // Stub for state toggle elements
             break;
         case 'coop_start':
             coopSync.establishCoop(userId, payload.partner);
             break;
         case 'coop_stop':
             // Stub
             break;
         case 'roulette_spin':
             roulette.spin(userId);
             break;
     }
  } catch (err) {
     console.error('Command Error', err);
  }
}

module.exports = { handleCommand };
