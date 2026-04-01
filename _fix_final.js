const fs = require('fs');

// --- DASHBOARD ---
let h = fs.readFileSync('public/dashboard.html', 'utf8');

// 1. Add timerRunning and currentTimerMs to global scope
h = h.replace(
  'let hideDashboardEvents = false; // Filter state',
  'let hideDashboardEvents = false; // Filter state\n    let timerRunning = false;\n    let currentTimerMs = 0;'
);

// 2. Add Rate Limiting (Button Disable/Debounce)
// We wrap fetch inside sendAction with an active-call check
h = h.replace(
  /async function sendAction\(actionType, payloadObj = \{\}\) \{[\s\S]*?console\.error\('Command failed', err\);\n      \}\n    \}/m,
  `let actionInFlight = false;
    async function sendAction(actionType, payloadObj = {}) {
      if (actionInFlight) return; // Rate limit: Ignore repeated clicks until previous finishes
      actionInFlight = true;
      try {
        logEvent(\`→ \${actionType}\`, false, true);
        await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: actionType, targetUserId, ...payloadObj })
        });
      } catch (err) {
        console.error('Command failed', err);
      } finally {
        setTimeout(() => actionInFlight = false, 250); // 250ms minimum cool-down
      }
    }`
);

fs.writeFileSync('public/dashboard.html', h);


// --- OVERLAY ---
let o = fs.readFileSync('public/overlay.html', 'utf8');

// 3. Fix Roulette Spinning backwards
// Fix animateRouletteSpin to accumulate targetAngle if it's smaller
o = o.replace(
  /function animateRouletteSpin\(targetAngle, duration\) \{[\s\S]*?currentRotation = targetAngle;\n    \}/m,
  `function animateRouletteSpin(targetAngle, duration) {
      ensureRouletteContainer();
      const canvas = document.getElementById('roulette-canvas');
      if (!canvas) return;
      
      // Prevent backward spinning by ensuring targetAngle is greater than currentRotation
      let forwardAngle = targetAngle;
      while (forwardAngle <= currentRotation) {
        forwardAngle += (360 * 20); // add extra spins to keep moving forward securely
      }
      
      canvas.style.transition = 'none';
      canvas.style.transform = \`rotate(\${currentRotation}deg)\`;
      canvas.offsetHeight; // force reflow
      canvas.style.transition = \`transform \${duration}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)\`;
      canvas.style.transform = \`rotate(\${forwardAngle}deg)\`;
      currentRotation = forwardAngle;
    }`
);

// 4. Fix floating time chip to be positioned relative to the timer text, NOT fixed in corner
o = o.replace(
  /function renderTimeChip\(addedMs\) \{[\s\S]*?setTimeout\(\(\) => c\.remove\(\), 2500\);\n    \}/m,
  `function renderTimeChip(addedMs) {
      const cd = document.getElementById('cd-display');
      if (!cd) return;
      
      const c = document.createElement('div');
      c.innerText = \`+\${addedMs/1000}s\`;
      c.style.cssText = 'position:absolute; top: -30px; right: 0; color:#53FC18; font-weight:bold; font-size:20px; text-shadow:0 2px 6px rgba(0,0,0,0.5); animation:chipSlide 2.5s ease forwards; z-index:100;';
      
      // Append inside the CD container directly so it flows with its position
      cd.appendChild(c);
      setTimeout(() => c.remove(), 2500);
    }`
);

fs.writeFileSync('public/overlay.html', o);

// --- SERVER (Goals API State Fix) ---
let s = fs.readFileSync('server.js', 'utf8');
// Fix getGoalState returning null which breaks dashboard fetch for fresh loads
s = s.replace(
  /const goalState = goals\.getGoalState\(userId\);/m,
  `const goalState = goals.getGoalState(userId) || await goals.initUser(userId);`
);
fs.writeFileSync('server.js', s);

console.log('Final fixes applied successfully');
