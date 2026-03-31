const alertQueue = require('./alertQueue');

function handleEvent(userId, eventType, payload) {
  console.log(`[eventRouter] Routing ${eventType} for user ${userId}`);
  
  // Pass directly to Alert Queue for overlay notifications
  alertQueue.enqueue(userId, eventType, payload);
  
  // Stubs for Phase 4:
  if (eventType === 'channel.subscription.new') {
    // countdown.addTime(...)
    // goals.increment(...)
  } else if (eventType === 'channel.subscription.gifts') {
    // countdown.addTime(...)
    // goals.increment(...)
  }
}

module.exports = { handleEvent };
