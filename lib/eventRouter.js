const alertQueue = require('./alertQueue');
const countdown = require('./countdown');
const goals = require('./goals');

async function handleEvent(userId, eventType, payload, isMock = false) {
  console.log(`[eventRouter] Routing ${eventType} for user ${userId}${isMock ? ' (MOCK)' : ''}`);
  
  // Pass directly to Alert Queue for overlay notifications
  alertQueue.enqueue(userId, eventType, payload);
  
  const timerConfig = countdown.getConfig(userId);
  const source = isMock ? `mock-${eventType}` : eventType;
  
  if (eventType === 'channel.subscription.new') {
    if (timerConfig) countdown.addTime(userId, timerConfig.timePerSub, isMock ? 'mock-new-sub' : 'new-sub');
    goals.increment(userId, 1, isMock ? 'mock-new-sub' : 'new-sub');
  } else if (eventType === 'channel.subscription.gifts') {
    const giftCount = payload.giftees ? payload.giftees.length : 1;
    if (timerConfig) countdown.addTime(userId, timerConfig.timePerGiftedSub * giftCount, isMock ? 'mock-gifted-sub' : 'gifted-sub');
    goals.increment(userId, 1 * giftCount, isMock ? 'mock-gifted-sub' : 'gifted-sub');
  } else if (eventType === 'channel.followed') {
     if (timerConfig && timerConfig.timePerFollow > 0) countdown.addTime(userId, timerConfig.timePerFollow, isMock ? 'mock-follow' : 'follow');
  } else if (eventType === 'kicks.gifted') {
     if (timerConfig && timerConfig.timePerKicksGift > 0) countdown.addTime(userId, timerConfig.timePerKicksGift, isMock ? 'mock-kicks' : 'kicks');
  }
}

module.exports = { handleEvent };
