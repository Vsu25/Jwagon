const countdown = require('./countdown');
const goals = require('./goals');
const roulette = require('./roulette');
const stateManager = require('./stateManager');
const eventRouter = require('./eventRouter');

async function handleCommand(userId, payload) {
  try {
     switch (payload.action) {
         case 'countdown_start':
             await countdown.start(userId);
             break;
         case 'countdown_stop':
             await countdown.stop(userId);
             break;
         case 'countdown_add':
             await countdown.addTime(userId, payload.ms, 'manual');
             break;
         case 'countdown_custom_add':
             await countdown.addTime(userId, payload.ms, 'manual-custom');
             break;
         case 'countdown_set':
             // Harmonized with new countdown.js
             if (typeof countdown.setTime === 'function') {
                await countdown.setTime(userId, payload.ms);
             }
             break;
         case 'toggle':
             const config = await stateManager.loadState(userId);
             const current = config.elements?.[payload.element]?.visible;
             const newValue = (current === undefined) ? false : !current;
             await stateManager.setState(userId, `elements.${payload.element}.visible`, newValue, 'toggle');
             break;
         case 'roulette_spin':
             await roulette.spin(userId, payload.slices);
             break;
         case 'goals_save':
             if (typeof goals.updateGoals === 'function') {
                await goals.updateGoals(userId, payload.goals);
             }
             break;
         case 'goals_manual_add':
             await goals.increment(userId, payload.amount || 1, 'manual');
             break;
         case 'goals_revert_mocks':
             await goals.revertMockIncr(userId);
             break;
         case 'mock_event':
             const eventType = payload.eventType || 'channel.subscription.new';
             const mockPayload = getMockPayload(eventType);
             await eventRouter.handleEvent(userId, eventType, mockPayload, true);
             break;
         case 'set_position':
             await stateManager.setState(userId, `elements.${payload.element}.position`, {
               x: payload.x,
               y: payload.y
             }, 'position');
             break;
         case 'session_reset':
             // Emergency Reset: Clear session state in DB
             await stateManager.setState(userId, 'session', {}, 'reset');
             break;
         case 'state_sync_heartbeat':
             // For stateless mode, we just ensure the DB is updated with latest from dash if provided
             if (payload.session) {
                await stateManager.setState(userId, 'session', payload.session, 'heartbeat');
             }
             break;
     }
  } catch (err) {
     console.error('Command Error', err);
  }
}

function getMockPayload(eventType) {
  const payloads = {
    'channel.subscription.new': {
      broadcaster: { user_id: 1, username: 'streamer', is_anonymous: false },
      subscriber: { user_id: Math.floor(Math.random() * 10000), username: 'test_viewer_' + Math.floor(Math.random() * 100), is_anonymous: false },
      duration: 1,
      created_at: new Date().toISOString()
    },
    'channel.followed': {
      broadcaster: { user_id: 1, username: 'streamer', is_anonymous: false },
      follower: { user_id: Math.floor(Math.random() * 10000), username: 'new_follower_' + Math.floor(Math.random() * 100), is_anonymous: false }
    }
  };
  return payloads[eventType] || payloads['channel.subscription.new'];
}

module.exports = { handleCommand };
