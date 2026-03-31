const queues = new Map(); // userId -> event queue []
const isPlaying = new Map(); // userId -> boolean

const TEMPLATES = {
  'channel.subscription.new': { anim: 'anim-scale-pop', duration: 4000, parse: p => `${p.subscriber.username} subscribed!` },
  'channel.subscription.gifts': { anim: 'anim-bounce-drop', duration: 5000, parse: p => `${p.gifter.username} gifted ${p.giftees ? p.giftees.length : 'some'} subs!` },
  'channel.followed': { anim: 'anim-slide-up', duration: 3000, parse: p => `${p.follower.username} followed!` },
  'kicks.gifted': { anim: 'anim-glitch', duration: 5000, parse: p => `${p.sender.username} sent ${p.gift.amount} Kicks!` }
};

function enqueue(userId, eventType, payload) {
  if (!queues.has(userId)) queues.set(userId, []);
  
  const template = TEMPLATES[eventType];
  if (!template) return;

  queues.get(userId).push({
    id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000),
    text: template.parse(payload),
    anim: template.anim,
    duration: template.duration
  });

  processQueue(userId);
}

function processQueue(userId) {
  if (isPlaying.get(userId)) return;
  
  const queue = queues.get(userId);
  if (!queue || queue.length === 0) return;
  
  isPlaying.set(userId, true);
  const alert = queue.shift();
  
  const { broadcast } = require('../server');
  broadcast({
    type: 'alert:fire',
    userId,
    data: alert
  }, [userId]);
  
  // Minimum 500ms gap between alerts
  setTimeout(() => {
    isPlaying.set(userId, false);
    processQueue(userId);
  }, alert.duration + 500);
}

function skip(userId) {
  isPlaying.set(userId, false);
  processQueue(userId);
}

function clear(userId) {
  if (queues.has(userId)) queues.set(userId, []);
  isPlaying.set(userId, false);
}

module.exports = { enqueue, skip, clear };
