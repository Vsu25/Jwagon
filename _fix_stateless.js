const fs = require('fs');

// --- SERVER (Stateless Adaptations) ---
let g = fs.readFileSync('lib/goals.js', 'utf8');
g = g.replace(
  /async function revertMocks\(userId\) \{[\s\S]*?const mockAmount = mockTracking\.get\(userId\) \|\| 0;/m,
  `async function revertMocks(userId, amount) {
  const mockAmount = amount || mockTracking.get(userId) || 0;`
);
fs.writeFileSync('lib/goals.js', g);

let ch = fs.readFileSync('lib/commandHandler.js', 'utf8');
ch = ch.replace(
  /const reverted = await goals\.revertMocks\(userId\);/m,
  `const reverted = await goals.revertMocks(userId, payload.amount);`
);
// Make Roulette spin accept slices explicitly to survive lambda reboots
ch = ch.replace(
  /case 'roulette_spin':\s*\/\/ Resolves after 7.5s animation timeout\s*await roulette\.spin\(userId\);/m,
  `case 'roulette_spin':
             // Resolves after 7.5s animation timeout
             await roulette.spin(userId, payload.slices);`
);
fs.writeFileSync('lib/commandHandler.js', ch);

let r = fs.readFileSync('lib/roulette.js', 'utf8');
r = r.replace(
  /async function spin\(userId\) \{[\s\S]*?const userState = await initUser\(userId\);/m,
  `async function spin(userId, explicitlyProvidedSlices = null) {
  const userState = await initUser(userId);
  if (explicitlyProvidedSlices) userState.slices = explicitlyProvidedSlices;`
);
fs.writeFileSync('lib/roulette.js', r);


// --- DASHBOARD (Send state to bridge the serverless gap) ---
let d = fs.readFileSync('public/dashboard.html', 'utf8');

// Update revert mock button so it sends the amount
d = d.replace(
  /function revertMockSubs\(\) \{[\s\S]*?if \(mockCount > 0\) \{[\s\S]*?sendAction\('goals_revert_mocks'\);[\s\S]*?\}[\s\S]*?\}/m,
  `function revertMockSubs() {
      if (mockCount > 0) {
        sendAction('goals_revert_mocks', { amount: mockCount });
        mockCount = 0;
        document.getElementById('revert-test-btn').style.display = 'none';
      }
    }`
);

// Update Roulette spin Wheel to pass slices
d = d.replace(
  /sendAction\('roulette_spin'\);/m,
  `sendAction('roulette_spin', { slices: rouletteSlices });`
);

fs.writeFileSync('public/dashboard.html', d);

console.log('Stateless adaptations applied! Dash works as Source of Truth.');
