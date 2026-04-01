const fs = require('fs');

let h = fs.readFileSync('public/dashboard.html', 'utf8');

// Dashboard changes

// 1. Add filter UI to Event Log header
h = h.replace(
  '<div class="panel-header">\n            📜 Event Log\n          </div>',
  `<div class="panel-header" style="justify-content:space-between; display:flex; align-items:center;">
            <span>📜 Event Log</span>
            <div style="display:flex; gap:8px; align-items:center;">
              <label style="font-size:0.7rem; color:var(--text-secondary); display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" onchange="hideDashboardEvents = this.checked; applyEventFilter();"> Filter Noise
              </label>
              <button class="btn btn-sm" onclick="clearMockEvents()">Clear Mocks</button>
            </div>
          </div>`
);

// 2. Update logEvent
h = h.replace(
  /function logEvent\(text, isMock = false\) \{[\s\S]*?while \(cont\.children\.length > 50\) cont\.removeChild\(cont\.lastChild\);\n    \}/m,
  `function logEvent(text, isMock = false, isNoise = false) {
      const cont = document.getElementById('events-container');
      if (cont.querySelector('.event-item')?.style.color) cont.innerHTML = '';
      const el = document.createElement('div');
      el.className = 'event-item' + (isMock ? ' mock-event' : '') + (isNoise ? ' noise-event' : '');
      const mockBadge = isMock ? '<span class="mock-badge">TEST</span> ' : '';
      el.innerHTML = \`<span class="time">\${new Date().toLocaleTimeString()}</span> \${mockBadge}\${text}\`;
      
      if (hideDashboardEvents && isNoise) {
        el.style.display = 'none';
      }
      
      cont.prepend(el);
      while (cont.children.length > 50) cont.removeChild(cont.lastChild);
    }

    function applyEventFilter() {
      const items = document.querySelectorAll('.event-item.noise-event');
      items.forEach(el => {
        el.style.display = hideDashboardEvents ? 'none' : 'block';
      });
    }

    function clearMockEvents() {
      const items = document.querySelectorAll('.event-item.mock-event');
      items.forEach(el => el.remove());
      logEvent('🧹 Cleared all mock events in log.', false, true);
    }`
);

// 3. Mark config, revert, switch, sendAction as noise
h = h.replace(/logEvent\('⚙ Timer config updated'\)/g, "logEvent('⚙ Timer config updated', false, true)");
h = h.replace(/logEvent\(\`↩ Reverted \S+ mock subs\`\)/g, "logEvent(`↩ Reverted \${msg.data.revertedAmount} mock subs`, false, true)");
h = h.replace(/logEvent\(\`→ \S+\`\)/g, "logEvent(`→ \${actionType}`, false, true)");
h = h.replace(/logEvent\(\`Timer \S+s\`\)/g, "logEvent(`Timer \${msg.data.addedMs > 0 ? '+' : ''}\${msg.data.addedMs/1000}s`, false, false)"); // Wait, timer adds are real events, keep them visible.
// Actually, earlier regex for timer was: logEvent(\`Timer \${msg.data.addedMs > 0 ? '+' : ''}\${msg.data.addedMs/1000}s\`);

// Fix showAllGoals undefined issue in goal handlers
h = h.replace(/if \(showAllGoals\) renderAllGoalsList\(\);/g, "if (typeof showAllGoals !== 'undefined' && showAllGoals) renderAllGoalsList();");

fs.writeFileSync('public/dashboard.html', h);

// Overlay changes
let o = fs.readFileSync('public/overlay.html', 'utf8');

// Roulette hide fix: ensuring it stays hidden
o = o.replace(
  /function ensureRouletteContainer\(\) \{[\s\S]*?return rc;\n    \}/m,
  `function ensureRouletteContainer() {
      let rc = document.getElementById('roulette-container');
      if (!rc) {
        rc = document.createElement('div');
        rc.id = 'roulette-container';
        rc.className = 'overlay-element fade-out'; // Start faded out!
        rc.innerHTML = \`
          <div class="roulette-frame">
            <div class="arrow-outline"></div>
            <div id="roulette-pointer"></div>
            <canvas id="roulette-canvas" width="680" height="680"></canvas>
          </div>
        \`;
        container.appendChild(rc);
      }
      if (!elementVisibility.roulette) rc.style.display = 'none';
      else rc.style.display = '';
      return rc;
    }`
);

// Don't call drawRouletteWheel inside applyInitialState except to define slices, because drawRouletteWheel causes it to appear? 
// No, drawRouletteWheel calls ensureRouletteContainer. If ensureRouletteContainer adds fading out, it's fine.
o = o.replace(
  /case 'roulette:spin':\s+if \(elementVisibility.roulette\) \{\s+showRouletteWheel\(\);\s+animateRouletteSpin\(msg\.data\.targetAngle, msg\.data\.duration\);\s+\}\s+break;/m,
  `case 'roulette:spin':
          if (elementVisibility.roulette) {
            showRouletteWheel();
            // Delay the spin slightly so the fade-in finishes
            setTimeout(() => {
              animateRouletteSpin(msg.data.targetAngle, msg.data.duration);
            }, 150);
          }
          break;`
);

o = o.replace(
  /case 'roulette:result':\s+if \(elementVisibility.roulette\) showRouletteResult\(msg\.data\.result\);\s+break;/m,
  `case 'roulette:result':
          if (elementVisibility.roulette) {
            showRouletteResult(msg.data.result);
            setTimeout(() => hideRouletteWheel(), 5000); // Hide after 5 seconds
          }
          break;`
);

fs.writeFileSync('public/overlay.html', o);

console.log('UI Fixes applied successfully!');
