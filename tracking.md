# StreamDeck - Tracking Document

## Phase 1: Server + Auth + Database
- [x] **Step 1: Project scaffold**
  - [x] Create `package.json` with dependencies
  - [x] Create `.env.example`
  - [x] Create `server.js` with Express, basic routes, static serving
  - [x] Create empty `lib/` files as stubs
- [x] **Step 2: Database**
  - [x] Create Supabase project (waiting for user setup / API key)
  - [x] Run migration SQL from `agent.md` Section 5
  - [x] Create `lib/supabase.js` with client initialization
- [x] **Step 3: Authentication**
  - [x] Create `public/login.html` (Kick OAuth button + mod login form)
  - [x] Create `lib/auth.js`
- [x] **Step 4: WebSocket hub**
  - [x] In `server.js`, add `ws` WebSocket server
  - [x] Client registration with `userId` and `role` tagging
  - [x] `broadcast(message, targetUserIds)` function
  - [x] Handle reconnection and heartbeat

## Phase 2: Overlay + Dashboard shell
- [x] **Step 5: State manager**
  - [x] Create `lib/stateManager.js`
- [x] **Step 6: Overlay page**
  - [x] Create `public/overlay.html`
  - [x] Add CSS animation library (`public/css/overlay-anims.css`)
- [x] **Step 7: Dashboard shell**
  - [x] Create `public/dashboard.html`

## Phase 3: Kick Webhooks + Undo + Alerts
- [x] **Step 8: Kick webhook handler**
  - [x] Create `lib/kickWebhook.js`
- [x] **Step 9: Undo engine**
  - [x] Create `lib/undoEngine.js`
- [x] **Step 10: Alert queue**
  - [x] Create `lib/alertQueue.js`

## Phase 4: Countdown + Goals
- [x] **Step 11: Countdown timer**
  - [x] Create `lib/countdown.js`
- [x] **Step 12: Goal system**
  - [x] Create `lib/goals.js`
- [x] **Step 13: Countdown overlay + dashboard**
- [x] **Step 14: Goals overlay + dashboard**

## Phase 5: Co-op System
- [x] **Step 15: Co-op session management**
  - [x] Create `lib/coopSync.js`
- [x] **Step 16: Co-op countdown sync**
- [x] **Step 17: Co-op goals sync + cross-notifications**

## Phase 6: Roulette + Polish
- [ ] **Step 18: Roulette system**
  - [ ] Create `lib/roulette.js`
- [ ] **Step 19: Dashboard panels**
- [ ] **Step 20: Mobile + deployment**
