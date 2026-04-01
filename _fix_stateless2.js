const fs = require('fs');

let d = fs.readFileSync('public/dashboard.html', 'utf8');
d = d.replace(
  /sendAction\('goals_revert_mocks', \{ amount: mockCount \}\);/m,
  `sendAction('goals_revert_mocks', { amount: mockCount, overrideCount: Math.max(0, currentGoalCount - mockCount) });`
);
fs.writeFileSync('public/dashboard.html', d);

let sj = fs.readFileSync('lib/goals.js', 'utf8');
sj = sj.replace(
  /async function revertMocks\(userId, amount\) \{[\s\S]*?userState\.currentCount = Math\.max\(0, userState\.currentCount - mockAmount\);/m,
  `async function revertMocks(userId, amount, overrideCount) {
  const mockAmount = amount || mockTracking.get(userId) || 0;
  if (mockAmount === 0) return 0;
  
  const userState = await initUser(userId);
  const old = userState.currentCount;
  userState.currentCount = overrideCount !== undefined ? overrideCount : Math.max(0, userState.currentCount - mockAmount);`
);
fs.writeFileSync('lib/goals.js', sj);

let ch = fs.readFileSync('lib/commandHandler.js', 'utf8');
ch = ch.replace(
  /const reverted = await goals\.revertMocks\(userId, payload\.amount\);/m,
  `const reverted = await goals.revertMocks(userId, payload.amount, payload.overrideCount);`
);
fs.writeFileSync('lib/commandHandler.js', ch);

console.log('Fixed currentCount overwriting with overrideCount feature.');
