const alertQueue = require('./alertQueue');
const countdown = require('./countdown');
const goals = require('./goals');

async function handleEvent(userId, eventType, payload) {
  console.log(`[eventRouter] Routing ${eventType} for user ${userId}`);
  
  // Pass directly to Alert Queue for overlay notifications
  alertQueue.enqueue(userId, eventType, payload);
  
  const timerConfig = countdown.getConfig(userId);
  
  if (eventType === 'channel.subscription.new') {
    if (timerConfig) countdown.addTime(userId, timerConfig.timePerSub, 'new-sub');
    goals.increment(userId, 1, 'new-sub');
  } else if (eventType === 'channel.subscription.gifts') {
    const giftCount = payload.giftees ? payload.giftees.length : 1;
    if (timerConfig) countdown.addTime(userId, timerConfig.timePerGiftedSub * giftCount, 'gifted-sub');
    goals.increment(userId, 1 * giftCount, 'gifted-sub');
  } else if (eventType === 'channel.followed') {
     if (timerConfig && timerConfig.timePerFollow > 0) countdown.addTime(userId, timerConfig.timePerFollow, 'follow');
  } else if (eventType === 'kicks.gifted') {
     if (timerConfig && timerConfig.timePerKicksGift > 0) countdown.addTime(userId, timerConfig.timePerKicksGift, 'kicks');
  }
}

module.exports = { handleEvent };
