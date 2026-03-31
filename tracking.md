# StreamDeck - Tracking Document

## Phase 1: Server + Auth + Database
- [x] **Step 1: Project scaffold**
  - [x] Create `package.json` with dependencies
  - [x] Create `.env.example`
  - [x] Create `server.js` with Express, basic routes, static serving
  - [x] Create empty `lib/` files as stubs
- [x] **Step 2: Database**
  - [ ] Create Supabase project (waiting for user setup / API key)
  - [ ] Run migration SQL from `agent.md` Section 5
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
- [ ] **Step 5: State manager**
  - [ ] Create `lib/stateManager.js`
- [ ] **Step 6: Overlay page**
  - [ ] Create `public/overlay.html`
  - [ ] Add CSS animation library (`public/css/overlay-anims.css`)
- [ ] **Step 7: Dashboard shell**
  - [ ] Create `public/dashboard.html`

## Phase 3: Kick Webhooks + Undo + Alerts
- [ ] **Step 8: Kick webhook handler**
  - [ ] Create `lib/kickWebhook.js`
- [ ] **Step 9: Undo engine**
  - [ ] Create `lib/undoEngine.js`
- [ ] **Step 10: Alert queue**
  - [ ] Create `lib/alertQueue.js`

## Phase 4: Countdown + Goals
- [ ] **Step 11: Countdown timer**
  - [ ] Create `lib/countdown.js`
- [ ] **Step 12: Goal system**
  - [ ] Create `lib/goals.js`
- [ ] **Step 13: Countdown overlay + dashboard**
- [ ] **Step 14: Goals overlay + dashboard**

## Phase 5: Co-op System
- [ ] **Step 15: Co-op session management**
  - [ ] Create `lib/coopSync.js`
- [ ] **Step 16: Co-op countdown sync**
- [ ] **Step 17: Co-op goals sync + cross-notifications**

## Phase 6: Roulette + Polish
- [ ] **Step 18: Roulette system**
  - [ ] Create `lib/roulette.js`
- [ ] **Step 19: Dashboard panels**
- [ ] **Step 20: Mobile + deployment**
