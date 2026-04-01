const countdown = require('./countdown');
const goals = require('./goals');
const coopSync = require('./coopSync');
const roulette = require('./roulette');
const stateManager = require('./stateManager');
const eventRouter = require('./eventRouter');

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
         case 'countdown_custom_add':
             countdown.addTime(userId, payload.ms, 'manual-custom');
             break;
         case 'countdown_set':
             countdown.setStartTime(userId, payload.ms);
             break;
         case 'countdown_reset':
             countdown.reset(userId);
             break;
         case 'countdown_undo_last':
             countdown.undoLastAdd(userId);
             break;
         case 'countdown_update_config':
             countdown.updateConfig(userId, payload.config);
             break;
         case 'toggle':
             const currentState = await stateManager.getState(userId, `elements.${payload.element}.visible`);
             const newValue = currentState === undefined ? false : !currentState;
             await stateManager.setState(userId, `elements.${payload.element}.visible`, newValue, 'toggle');
             break;
         case 'coop_start':
             coopSync.establishCoop(userId, payload.partner);
             break;
         case 'coop_stop':
             break;
         case 'roulette_spin':
             roulette.spin(userId);
             break;
         case 'roulette_save_slices':
             roulette.saveSlices(userId, payload.slices);
             break;
         case 'goals_save':
             goals.setGoals(userId, payload.goals);
             break;
         case 'goals_manual_add':
             goals.manualIncrement(userId, payload.amount || 1);
             break;
         case 'goals_revert_mocks':
             const reverted = await goals.revertMocks(userId);
             const { broadcast } = require('../server');
             broadcast({ type: 'goal:mock_reverted', userId, data: { revertedAmount: reverted } }, [userId]);
             break;
         case 'mock_event':
             const eventType = payload.eventType || 'channel.subscription.new';
             const mockPayload = getMockPayload(eventType);
             eventRouter.handleEvent(userId, eventType, mockPayload, true);
             break;
         case 'set_position':
             await stateManager.setState(userId, `elements.${payload.element}.position`, {
               x: payload.x,
               y: payload.y
             }, 'position');
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
    },
    'channel.subscription.gifts': {
      broadcaster: { user_id: 1, username: 'streamer', is_anonymous: false },
      gifter: { user_id: Math.floor(Math.random() * 10000), username: 'generous_viewer', is_anonymous: false },
      giftees: [
        { user_id: 101, username: 'lucky_1', is_anonymous: false },
        { user_id: 102, username: 'lucky_2', is_anonymous: false },
        { user_id: 103, username: 'lucky_3', is_anonymous: false }
      ],
      created_at: new Date().toISOString()
    }
  };
  return payloads[eventType] || payloads['channel.subscription.new'];
}

module.exports = { handleCommand };
