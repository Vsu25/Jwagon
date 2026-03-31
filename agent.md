# StreamDeck — Agent Build Instructions

> This file tells an AI coding agent (Claude, Cursor, Copilot, etc.) exactly what to build, in what order, and how every piece connects. Read this BEFORE writing any code.

---

## 1. What This Project Is

StreamDeck is a **multi-streamer OBS overlay management system** for Kick.com. It has:

- A **Node.js server** that receives Kick webhook events and relays them via WebSocket
- A **login system** using Kick OAuth 2.1 + internal auth (streamer + mod roles)
- A **dashboard** (web/mobile) where the streamer controls overlays, countdown, goals, roulette
- An **overlay output** page that OBS captures as a browser source (transparent, CSS-only animations)
- A **co-op mode** where 2 streamers share countdown + goals across independent overlays

---

## 2. Architecture Overview

```
┌──────────────┐     HTTPS POST      ┌─────────────────────────────────┐
│  Kick.com    │ ──────────────────→  │  Node.js Server (Vercel/local)  │
│  Webhooks    │                      │                                 │
│  (per user)  │                      │  /api/webhook/:userId           │
└──────────────┘                      │  /api/auth/kick (OAuth 2.1)     │
                                      │  /api/auth/login (session)      │
                                      │  /dashboard (SPA)               │
                                      │  /overlay/:userId (OBS source)  │
                                      │                                 │
                                      │  WebSocket hub (ws library)     │
                                      │  State manager (per-user)       │
                                      │  Co-op sync engine              │
                                      └────────┬──────────┬─────────────┘
                                               │          │
                                      ┌────────▼──┐  ┌───▼──────────┐
                                      │ Dashboard  │  │ Overlay      │
                                      │ (phone/PC) │  │ (OBS source) │
                                      │ per user   │  │ per user     │
                                      └────────────┘  └──────────────┘
```

### Key principle: Per-user state, shared co-op layer

Each streamer has their own:
- Overlay state (elements, positions, styles, alerts)
- Overlay output URL (`/overlay/:userId`)
- Kick webhook subscription
- Dashboard session

Co-op mode adds a **shared layer** on top:
- Shared countdown timer (any linked streamer's subs add time)
- Shared goal counter (any linked streamer's subs increment)
- Cross-notifications (streamer B sees "Goal reached by Streamer A's viewers")

---

## 3. Tech Stack (Do NOT deviate)

| Layer | Technology | Why |
|-------|-----------|-----|
| Server | Node.js 20+ with Express | Simple, Vercel-compatible |
| WebSocket | `ws` library | Lightweight, no Socket.IO bloat |
| Auth | Kick OAuth 2.1 with PKCE + express-session + bcrypt | Kick login for streamers, internal auth for mods |
| Database | Supabase (PostgreSQL) | Free tier, Realtime subscriptions, row-level security |
| Overlay | Single HTML file, vanilla JS + CSS | OBS browser source constraint: no build step |
| Dashboard | React via CDN (no build step) or vanilla JS | Complex state needs React; CDN avoids build tools |
| Deployment | Vercel (serverless + static) | Free tier, auto-deploy from GitHub |
| Real-time relay | Supabase Realtime OR Ably free tier | Vercel can't hold WS connections |

### NPM Dependencies (keep minimal)
```json
{
  "dependencies": {
    "express": "^4.18",
    "ws": "^8.16",
    "dotenv": "^16.3",
    "bcrypt": "^5.1",
    "express-session": "^1.17",
    "cookie-parser": "^1.4",
    "@supabase/supabase-js": "^2.39"
  }
}
```

---

## 4. File Structure (Create in this order)

```
streamdeck/
├── server.js                    # Express + WS + session + routes
├── package.json
├── .env.example                 # Template for env vars
├── lib/
│   ├── auth.js                  # Kick OAuth flow + internal auth + session middleware
│   ├── kickWebhook.js           # Ed25519 signature validation + event parsing
│   ├── eventRouter.js           # Routes events to consumers (alerts, countdown, goals, roulette)
│   ├── stateManager.js          # Per-user state with get/set/broadcast/snapshot
│   ├── undoEngine.js            # Linked action history, push/pop/revert
│   ├── countdown.js             # Server-side timer, auto-add, co-op sync
│   ├── goals.js                 # Goal ladder, auto-increment, co-op sync
│   ├── roulette.js              # Weighted spin, action execution, auto-trigger
│   ├── alertQueue.js            # FIFO sequential playback
│   └── coopSync.js              # Cross-streamer shared state for countdown + goals
├── public/
│   ├── login.html               # Login page (Kick OAuth + internal auth)
│   ├── dashboard.html           # Dashboard SPA (React via CDN)
│   ├── overlay.html             # OBS browser source (vanilla JS + CSS)
│   └── css/
│       └── overlay-anims.css    # 8 animation presets as @keyframes
├── api/
│   └── webhook.js               # Vercel serverless function (mirrors server.js webhook handler)
├── supabase/
│   └── migrations/
│       └── 001_initial.sql      # Database schema
└── agent.md                     # This file
```

---

## 5. Database Schema (Supabase PostgreSQL)

```sql
-- Users table (populated on first Kick OAuth login)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kick_user_id INTEGER UNIQUE NOT NULL,
  kick_username TEXT NOT NULL,
  kick_avatar TEXT,
  kick_channel_slug TEXT,
  role TEXT DEFAULT 'streamer' CHECK (role IN ('streamer', 'mod', 'admin')),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mod assignments (which mods can control which streamers)
CREATE TABLE mod_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  mod_id UUID REFERENCES users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(streamer_id, mod_id)
);

-- Overlay configs (one per streamer)
CREATE TABLE overlay_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  config JSONB NOT NULL DEFAULT '{}',
  version INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Co-op sessions (links two streamers)
CREATE TABLE coop_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  shared_countdown JSONB DEFAULT '{"running": false, "currentMs": 3600000, "config": {}}',
  shared_goals JSONB DEFAULT '{"enabled": false, "currentCount": 0, "list": []}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Co-op members
CREATE TABLE coop_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES coop_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  share_countdown BOOLEAN DEFAULT true,
  share_goals BOOLEAN DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, user_id)
);

-- Event log (for replay and analytics)
CREATE TABLE event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  coop_session_id UUID REFERENCES coop_sessions(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Undo history
CREATE TABLE undo_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  coop_session_id UUID REFERENCES coop_sessions(id),
  action_type TEXT NOT NULL,
  forward_data JSONB NOT NULL,
  reverse_data JSONB NOT NULL,
  parent_id UUID REFERENCES undo_history(id),
  reverted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. Authentication Flow

### 6.1 Kick OAuth Login (for streamers)

```
User clicks "Login with Kick"
  → Redirect to https://id.kick.com/oauth/authorize
    with client_id, redirect_uri, scope=user:read+events:subscribe+channel:read,
    code_challenge (PKCE S256), state
  → User approves on Kick
  → Kick redirects to /api/auth/callback?code=XXX&state=YYY
  → Server exchanges code for tokens via POST https://id.kick.com/oauth/token
  → Server fetches user info via GET https://api.kick.com/public/v1/users
  → Server creates/updates user in Supabase
  → Server creates express-session with { userId, kickUserId, role }
  → Redirect to /dashboard
```

### 6.2 Internal Auth (for mods)

```
Streamer adds a mod via dashboard: enters mod's Kick username
  → Server looks up the Kick user
  → Creates entry in mod_assignments table
  → Mod can now log in with Kick OAuth
  → On login, server checks mod_assignments to determine which streamers they can control
  → Mod's dashboard shows a streamer selector dropdown
```

### 6.3 Session Middleware

```javascript
// Every route except /login, /api/auth/*, and /overlay/:userId checks:
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.redirect('/login');
  next();
}

// Overlay routes are PUBLIC (no auth) — OBS needs to access them
// But they require a valid userId parameter
```

---

## 7. Co-op Sync Engine — THE CRITICAL FEATURE

### How it works:

1. Streamer A creates a co-op session from their dashboard
2. Streamer A invites Streamer B (by Kick username)
3. Streamer B accepts the invite from their dashboard
4. Both streamers toggle which features to share: countdown, goals, or both
5. The server creates a `coop_sessions` row and two `coop_members` rows

### Event flow with co-op active:

```
Viewer subs to Streamer A's channel
  → Kick sends webhook to /api/webhook/streamerA
  → Server processes normally for Streamer A:
      - Fires sub alert on Streamer A's overlay
      - Adds time to Streamer A's personal countdown (if not co-op'd)
      - Increments Streamer A's personal goals (if not co-op'd)
  → Server checks: is Streamer A in a co-op session?
      YES → check which features are shared
      → If countdown is shared:
          - Add time to the SHARED countdown (coop_sessions.shared_countdown)
          - Broadcast countdown:update to ALL co-op members' overlays
          - Broadcast countdown:update to ALL co-op members' dashboards
      → If goals are shared:
          - Increment the SHARED goal counter (coop_sessions.shared_goals)
          - Check if a shared goal was reached
          - Broadcast goal:update to ALL co-op members
          - If goal reached: fire "Goal reached (from Streamer A's viewers)" alert
            on ALL co-op members' overlays
      → Streamer B's overlay shows:
          - NO sub alert (the sub was for Streamer A, not B)
          - YES countdown update (shared)
          - YES goal update (shared)
          - YES goal-reached notification IF a goal was hit
            (shows: "🎯 Goal 'Play horror game' reached! (via StreamerA's viewers)")
```

### What is NOT shared:
- Alerts (sub alerts, follow alerts, gift alerts) — these are ALWAYS per-streamer
- Overlay elements (positions, styles, toggles) — each streamer has their own layout
- Roulette — per-streamer (but roulette actions that affect countdown/goals DO propagate to shared state)
- Undo history — per-streamer for personal actions, but shared actions create entries for both streamers

### Co-op state isolation rules:
```
PERSONAL (per overlay):          SHARED (co-op session):
├── Alert box                    ├── Countdown timer value
├── Webcam frame                 ├── Countdown config
├── Social bar                   ├── Goal list
├── Chat ticker                  ├── Goal current count
├── Element positions            ├── Goal completion status
├── Element styles               └── (future: shared roulette)
├── Scene presets
├── Roulette wheel
└── Personal countdown/goals (when not in co-op)
```

---

## 8. Build Order (Follow EXACTLY)

### Phase 1: Server + Auth + Database (Steps 1-4)

**Step 1: Project scaffold**
- Create package.json with dependencies
- Create .env.example
- Create server.js with Express, basic routes, static serving
- Create empty lib/ files as stubs

**Step 2: Database**
- Create Supabase project
- Run migration SQL from section 5
- Create lib/supabase.js with client initialization

**Step 3: Authentication**
- Create public/login.html (Kick OAuth button + mod login form)
- Create lib/auth.js with:
  - Kick OAuth 2.1 flow with PKCE (id.kick.com endpoints)
  - Token exchange and user creation/lookup in Supabase
  - express-session configuration
  - requireAuth middleware
  - Mod assignment CRUD

**Step 4: WebSocket hub**
- In server.js, add ws WebSocket server
- Client registration with userId and role tagging
- broadcast(message, targetUserIds) function
- Handle reconnection and heartbeat

### Phase 2: Overlay + Dashboard shell (Steps 5-7)

**Step 5: State manager**
- Create lib/stateManager.js
- Per-user state stored in memory + synced to Supabase overlay_configs
- getState(userId, path), setState(userId, path, value)
- batchUpdate for linked mutations
- On setState: push undo entry + broadcast to user's clients

**Step 6: Overlay page**
- Create public/overlay.html
- Route: /overlay/:userId (NO auth required)
- Transparent background, absolute positioning
- WebSocket connection with userId
- Element renderer: creates/removes DOM nodes from state
- CSS animation library (public/css/overlay-anims.css)
- All 8 animation presets: fade, slide-up, slide-left, scale-pop, bounce-drop, blur-in, typewriter, glitch, celebrate

**Step 7: Dashboard shell**
- Create public/dashboard.html
- Route: /dashboard (requires auth)
- Dark theme, Kick green accent
- WebSocket connection with session userId
- Toggle panel for overlay elements
- 16:9 preview canvas
- Preset switcher
- If user is mod: streamer selector dropdown

### Phase 3: Kick Webhooks + Undo + Alerts (Steps 8-10)

**Step 8: Kick webhook handler**
- Create lib/kickWebhook.js
- Route: POST /api/webhook/:userId
- Ed25519 signature validation (fetch + cache Kick public key)
- Parse Kick-Event-Type header
- Normalize payload into internal event format
- Pass to eventRouter

**Step 9: Undo engine**
- Create lib/undoEngine.js
- push(userId, action): add to history (max 100)
- pop(userId): revert most recent
- revert(userId, actionId): revert specific action
- Linked actions: parent/children references
- Broadcast undo:update to user's clients

**Step 10: Alert queue**
- Create lib/alertQueue.js
- Per-user FIFO queue
- Sequential playback with configurable cooldown
- Templates per event type (gifted sub, new sub, follow, etc.)
- Dashboard controls: skip, clear, pause, reorder

### Phase 4: Countdown + Goals (Steps 11-14)

**Step 11: Countdown timer**
- Create lib/countdown.js
- Server-side setInterval (1000ms) per active timer
- addTime(userId, seconds, source): clamp to maxCap, push undo, broadcast
- Auto-add from Kick events (configurable seconds per event type)
- Manual controls: start, pause, reset, add, remove

**Step 12: Goal system**
- Create lib/goals.js
- Goal list with sequential milestones
- Auto-increment from Kick events
- Cumulative and per-goal count modes
- Goal completion detection + celebration alert trigger

**Step 13: Countdown overlay + dashboard**
- Overlay: monospaced HH:MM:SS, +Xs chips, last-60s pulse, zero animation
- Dashboard: timer display, start/pause/reset, manual add/remove, time log

**Step 14: Goals overlay + dashboard**
- Overlay: single bar mode + ladder mode
- Dashboard: sortable list editor, count mode toggle, manual increment

### Phase 5: Co-op System (Steps 15-17)

**Step 15: Co-op session management**
- Create lib/coopSync.js
- Dashboard UI: create session, invite by username, accept/decline
- Supabase: coop_sessions + coop_members CRUD
- Toggle shared features per member

**Step 16: Co-op countdown sync**
- When co-op countdown is enabled:
  - Personal countdown pauses (or hides)
  - Shared countdown becomes the active timer
  - Any co-op member's sub events add time to shared timer
  - Shared timer broadcasts to ALL co-op member overlays/dashboards

**Step 17: Co-op goals sync + cross-notifications**
- When co-op goals are enabled:
  - Shared goal list replaces personal goals
  - Any co-op member's sub events increment shared counter
  - Goal reached: fire notification on ALL co-op overlays
  - Notification text: "Goal reached! (via [streamerName]'s viewers)"
  - Sub/follow alerts remain per-streamer (NOT shared)

### Phase 6: Roulette + Polish (Steps 18-20)

**Step 18: Roulette system**
- Create lib/roulette.js
- Weighted random, segment config, action types
- Auto-trigger on Nth sub
- Actions that affect countdown/goals propagate through co-op if active

**Step 19: Dashboard panels**
- Countdown panel with time log
- Goals panel with list editor
- Roulette panel with segment editor + wheel preview
- Undo panel with full history timeline
- Co-op panel with session management

**Step 20: Mobile + deployment**
- Responsive dashboard (tab layout on mobile)
- Vercel configuration (vercel.json)
- Environment variable setup guide
- Supabase Realtime integration as WS replacement for production

---

## 9. Critical Implementation Notes

### Overlay constraints (OBS browser source)
- MUST be a single HTML file (can import CSS)
- Transparent background: `body { background: transparent; }`
- Only animate: `transform`, `opacity`, `clip-path`
- NEVER animate: width, height, top, left, margin, padding, background-color
- Use `will-change: transform, opacity` on animating elements, `auto` when idle
- Max 3 simultaneous animations
- Default easing: `cubic-bezier(0.16, 1, 0.3, 1)` for enters

### WebSocket message format
```json
{
  "type": "kick:event | state:update | countdown:update | goal:update | roulette:spin | alert:fire | coop:notification | undo:update",
  "userId": "uuid-of-target-user",
  "coopSessionId": "uuid-if-coop-related",
  "data": { ... }
}
```

### Co-op notification format
```json
{
  "type": "coop:notification",
  "data": {
    "event": "goal:reached",
    "goalName": "Play horror game",
    "triggeredBy": {
      "userId": "streamer-a-uuid",
      "username": "StreamerA",
      "avatar": "https://..."
    },
    "message": "Goal 'Play horror game' reached via StreamerA's viewers!"
  }
}
```

### Auth cookie config
```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax'
  }
}));
```

### Kick OAuth scopes needed
```
user:read channel:read events:subscribe chat:write
```

### Webhook URL pattern
Each user gets their own webhook endpoint:
```
https://your-app.vercel.app/api/webhook/{userId}
```
On first login, the server subscribes to Kick events for that user using their access token.

---

## 10. Testing Checklist

Before considering a phase complete, verify:

- [ ] Login with Kick OAuth works, creates user in Supabase
- [ ] Dashboard loads, shows correct user info
- [ ] Overlay loads at /overlay/:userId with transparent background
- [ ] Toggle on dashboard → element appears on overlay within 50ms
- [ ] Simulated Kick event → alert fires on overlay
- [ ] Countdown auto-adds time on sub event
- [ ] Goals auto-increment on sub event
- [ ] Undo reverts the most recent action correctly
- [ ] Co-op session created, both streamers see shared countdown
- [ ] Sub on Streamer A → shared countdown updates on both overlays
- [ ] Goal reached on Streamer A → notification fires on Streamer B's overlay
- [ ] Sub alert does NOT appear on Streamer B's overlay (alerts are personal)
- [ ] Mod can log in and control assigned streamer's dashboard
- [ ] Mobile dashboard works with touch targets ≥ 44px
- [ ] OBS browser source renders correctly at 1920x1080
