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
             await countdown.setStartTime(userId, payload.ms);
             break;
         case 'countdown_reset':
             await countdown.reset(userId);
             break;
         case 'countdown_undo_last':
             await countdown.undoLastAdd(userId);
             break;
         case 'countdown_update_config':
             await countdown.updateConfig(userId, payload.config);
             break;
         case 'toggle':
             const currentState = await stateManager.getState(userId, `elements.${payload.element}.visible`);
             const newValue = currentState === undefined ? false : !currentState;
             await stateManager.setState(userId, `elements.${payload.element}.visible`, newValue, 'toggle');
             break;
         case 'coop_start':
             await coopSync.establishCoop(userId, payload.partner);
             break;
         case 'coop_stop':
             break;
         case 'roulette_spin':
             // Resolves after 7.5s animation timeout
             await roulette.spin(userId, payload.slices);
             break;
         case 'roulette_save_slices':
             await roulette.saveSlices(userId, payload.slices);
             break;
         case 'goals_save':
             await goals.setGoals(userId, payload.goals);
             break;
         case 'goals_manual_add':
             await goals.manualIncrement(userId, payload.amount || 1);
             break;
         case 'goals_revert_mocks':
             const reverted = await goals.revertMocks(userId, payload.amount, payload.overrideCount);
             const { broadcast } = require('../server');
             await broadcast({ type: 'goal:mock_reverted', userId, data: { revertedAmount: reverted } }, [userId]);
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
         case 'state_sync_heartbeat':
             // Dashboard-driven source of truth — forward ALL data including visibility
             const { broadcast: heartbeatBroadcast } = require('../server');
             await heartbeatBroadcast({ 
               type: 'state_sync_heartbeat', 
               userId, 
               data: {
                 countdown: payload.countdown,
                 goals: payload.goals,
                 roulette: payload.roulette,
                 visibility: payload.visibility
               }
             }, [userId]);
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
