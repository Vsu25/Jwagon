const fs = require('fs');
const glob = require('glob');

// 1. Fix server.js broadcast logic to be async and wait for subscription
let s = fs.readFileSync('server.js', 'utf8');
s = s.replace(
  /async function broadcastRealtime\(channelName, eventName, payload\) \{[\s\S]*?^function broadcast/m,
  `async function broadcastRealtime(channelName, eventName, payload) {
  if (!supabase) return Promise.resolve();
  return new Promise((resolve) => {
    // Generate a unique client instance for this broadcast so we don't conflict with existing channels in a warm lambda
    const channel = supabase.channel(channelName + '-bcast-' + Date.now() + Math.floor(Math.random()*1000));
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.send({
            type: 'broadcast',
            event: eventName,
            payload: payload
          });
        } catch (e) {
          console.error('Realtime broadcast error:', e.message);
        } finally {
          supabase.removeChannel(channel);
          resolve();
        }
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        supabase.removeChannel(channel);
        resolve();
      }
    });

    // Timeout safety
    setTimeout(() => {
      supabase.removeChannel(channel);
      resolve();
    }, 2000);
  });
}

// Legacy-compatible broadcast wrapper used by lib modules
async function broadcast`
);

// Fix the broadcast wrapper in server.js
s = s.replace(
  /function broadcast\(messageObj, targetUserIds \= null\) \{[\s\S]*?\}\n/m,
  `async function broadcast(messageObj, targetUserIds = null) {
  if (!targetUserIds || targetUserIds.length === 0) return;
  const promises = targetUserIds.map(userId => {
    // Note: We use the exact channel name clients listen to (overlay:user-id)
    return broadcastRealtime(\`overlay:\${userId}\`, messageObj.type, messageObj.data || {});
  });
  await Promise.allSettled(promises);
}\n`
);

fs.writeFileSync('server.js', s);

// 2. Replace all `broadcast(` calls with `await broadcast(`
// Find files that import broadcast
const files = [
  'lib/alertQueue.js',
  'lib/commandHandler.js',
  'lib/coopSync.js',
  'lib/countdown.js',
  'lib/goals.js',
  'lib/roulette.js',
  'lib/stateManager.js'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  
  if (file === 'lib/roulette.js') {
    // Special fix for setTimeout inside spin() 
    content = content.replace(
      /setTimeout\(\(\) => \{[\s\S]*/,
      `setTimeout(async () => {
      userState.isSpinning = false;
      userState.result = winner.text;
      
      await broadcast({
        type: 'roulette:result',
        userId,
        data: { result: winner.text, action: winner.action || winner.text }
      }, [userId]);
      resolve();
    }, 7500);
  });
}`
    );
    // Add awaits for early broadcasts
    content = content.replace(/broadcast\(\{[\s\S]*?type: 'roulette:update'/m, `await broadcast({\n    type: 'roulette:update'`);
    content = content.replace(/broadcast\(\{[\s\S]*?type: 'roulette:spin'/m, `await broadcast({\n    type: 'roulette:spin'`);
    content = content.replace(/broadcast\(\{[\s\S]*?type: 'roulette:update'/m, `await broadcast({\n    type: 'roulette:update'`); // for saveSlices
  } else {
    // For other files, replace simple "broadcast(" with "await broadcast("
    // Except where they define it `const { broadcast } = ...`
    content = content.replace(/(\s+)broadcast\(\{/g, '$1await broadcast({');
  }
  
  fs.writeFileSync(file, content);
}

console.log('Broadcasts made async and SUBSCRIBED safely!');
