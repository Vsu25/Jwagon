# StreamDeck — Pre-Development Starter Kit

> Read this BEFORE opening your code editor. This document walks you through every external account and service you need, provides a test harness so you can develop without a live Kick stream, documents known Kick API pitfalls, and covers edge cases the PRD doesn't address.

---

## PART 1: Kick Developer App Setup (Do This First)

### Step 1: Enable 2FA on your Kick account
1. Go to https://kick.com/settings
2. Click **Security** tab
3. Enable **Two-Factor Authentication** (required for developer access)
4. Save the backup codes somewhere safe

### Step 2: Create a developer app
1. Go to https://kick.com/settings and select the **Developer** tab
2. Click **Create App**
3. Fill in the form:
   - **App Name**: StreamDeck (or whatever you want)
   - **Redirect URL**: `http://localhost:3000/api/auth/callback`
     (for local development — you'll change this to your Vercel URL later)
   - **Webhook URL**: Leave blank for now (you'll set this after deploying, or use ngrok)
4. Click **Create**
5. You'll receive:
   - **Client ID** — copy this to your `.env` file as `KICK_CLIENT_ID`
   - **Client Secret** — copy this as `KICK_CLIENT_SECRET` (you can only see it once!)

### Step 3: Note the OAuth endpoints
These are the URLs your server will use:
```
Authorization:  https://id.kick.com/oauth/authorize
Token exchange: https://id.kick.com/oauth/token
Token revoke:   https://id.kick.com/oauth/revoke
Token inspect:  https://id.kick.com/oauth/token/introspect
API base:       https://api.kick.com/public/v1
Public key:     https://api.kick.com/public/v1/public-key
```

### Step 4: Set up ngrok for local webhook testing
Kick webhooks need a **public URL**. During local development:
```bash
# Install ngrok (https://ngrok.com — free tier works)
npm install -g ngrok   # or download from ngrok.com

# Start your server first
node server.js   # runs on localhost:3000

# In another terminal, expose it
ngrok http 3000
```
ngrok gives you a URL like `https://abc123.ngrok.io`.
Go back to Kick developer settings and set your **Webhook URL** to:
`https://abc123.ngrok.io/api/webhook`

> **Important**: ngrok URLs change every time you restart ngrok (on the free plan). You'll need to update your Kick webhook URL each time. Vercel deployment eliminates this problem.

### Step 5: Subscribe to webhook events
After your server is running and a user has logged in via OAuth, you need to programmatically subscribe to events. Your server does this automatically on first login by calling:
```
POST https://api.kick.com/public/v1/events/subscriptions
Authorization: Bearer <user_access_token>
Content-Type: application/json

{
  "events": [
    { "name": "chat.message.sent", "version": 1 },
    { "name": "channel.followed", "version": 1 },
    { "name": "channel.subscription.new", "version": 1 },
    { "name": "channel.subscription.gifts", "version": 1 },
    { "name": "channel.subscription.renewal", "version": 1 },
    { "name": "livestream.status.updated", "version": 1 },
    { "name": "kicks.gifted", "version": 1 }
  ],
  "method": "webhook"
}
```

---

## PART 2: Supabase Setup

### Step 1: Create a Supabase project
1. Go to https://supabase.com and sign up (free tier is fine)
2. Click **New Project**
3. Choose a name (e.g., `streamdeck`), set a database password, pick a region close to you
4. Wait for the project to provision (~2 minutes)

### Step 2: Get your keys
1. Go to **Settings > API** in the Supabase dashboard
2. Copy these to your `.env`:
   - **Project URL** → `SUPABASE_URL`
   - **anon/public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_KEY` (keep this secret! Server-side only)

### Step 3: Run the database migration
1. Go to **SQL Editor** in the Supabase dashboard
2. Paste the full migration SQL from agent.md (Section 5)
3. Click **Run**
4. Verify the tables exist under **Table Editor**

### Step 4: Enable Realtime (for production)
1. Go to **Database > Replication** in the Supabase dashboard
2. Enable Realtime for these tables:
   - `overlay_configs`
   - `coop_sessions`
   - `event_log`
3. This lets the dashboard and overlay subscribe to live changes without a custom WebSocket server

---

## PART 3: Environment Variables Template

Create a `.env` file in your project root:

```env
# === Kick OAuth ===
KICK_CLIENT_ID=your_client_id_here
KICK_CLIENT_SECRET=your_client_secret_here

# === Server ===
PORT=3000
SESSION_SECRET=generate_a_random_64_char_string_here
BASE_URL=http://localhost:3000
NODE_ENV=development

# === Supabase ===
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=eyJhbG...your_anon_key
SUPABASE_SERVICE_KEY=eyJhbG...your_service_key

# === Optional: Ably (for Vercel production WS relay) ===
# ABLY_API_KEY=your_ably_key_here
```

To generate `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## PART 4: Test Harness (Simulated Kick Events)

This is the most important piece for development velocity. You cannot rely on real Kick events during development — you'd need actual viewers subscribing to your channel. Instead, create a test script that simulates every Kick event type.

### test-events.js

Save this file in your project root. It sends simulated webhook payloads to your local server.

```javascript
// test-events.js — Simulates Kick webhook events for local development
// Usage: node test-events.js [event-type] [user-id]
// Example: node test-events.js gifted-sub YOUR_USER_UUID

const http = require('http');

const USER_ID = process.argv[3] || 'test-user-id';
const BASE = `http://localhost:${process.env.PORT || 3000}`;

const events = {
  'new-sub': {
    type: 'channel.subscription.new',
    payload: {
      broadcaster: { user_id: 1, username: 'your_channel', is_anonymous: false, is_verified: true, profile_picture: '', channel_slug: 'your_channel', identity: null },
      subscriber: { user_id: 999, username: 'test_viewer', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'test_viewer', identity: null },
      duration: 1,
      created_at: new Date().toISOString()
    }
  },
  'gifted-sub': {
    type: 'channel.subscription.gifts',
    payload: {
      broadcaster: { user_id: 1, username: 'your_channel', is_anonymous: false, is_verified: true, profile_picture: '', channel_slug: 'your_channel', identity: null },
      gifter: { user_id: 888, username: 'generous_viewer', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'generous_viewer', identity: null },
      giftees: [
        { user_id: 101, username: 'lucky_viewer_1', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'lucky_1', identity: null },
        { user_id: 102, username: 'lucky_viewer_2', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'lucky_2', identity: null },
        { user_id: 103, username: 'lucky_viewer_3', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'lucky_3', identity: null },
        { user_id: 104, username: 'lucky_viewer_4', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'lucky_4', identity: null },
        { user_id: 105, username: 'lucky_viewer_5', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'lucky_5', identity: null }
      ],
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  },
  'follow': {
    type: 'channel.followed',
    payload: {
      broadcaster: { user_id: 1, username: 'your_channel', is_anonymous: false, is_verified: true, profile_picture: '', channel_slug: 'your_channel', identity: null },
      follower: { user_id: 777, username: 'new_follower', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'new_follower', identity: null }
    }
  },
  'renewal': {
    type: 'channel.subscription.renewal',
    payload: {
      broadcaster: { user_id: 1, username: 'your_channel', is_anonymous: false, is_verified: true, profile_picture: '', channel_slug: 'your_channel', identity: null },
      subscriber: { user_id: 666, username: 'loyal_viewer', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'loyal_viewer', identity: null },
      duration: 3,
      created_at: new Date().toISOString()
    }
  },
  'kicks-gift': {
    type: 'kicks.gifted',
    payload: {
      broadcaster: { user_id: 1, username: 'your_channel', is_anonymous: false, is_verified: true, profile_picture: '', channel_slug: 'your_channel', identity: null },
      sender: { user_id: 555, username: 'kicks_gifter', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'kicks_gifter', identity: null },
      gift: { amount: 100, name: 'Kick Gift', type: 'kick_gift', tier: 'standard', message: 'Love the stream!' },
      pinned_time_seconds: 0
    }
  },
  'go-live': {
    type: 'livestream.status.updated',
    payload: {
      broadcaster: { user_id: 1, username: 'your_channel', is_anonymous: false, is_verified: true, profile_picture: '', channel_slug: 'your_channel', identity: null },
      is_live: true,
      title: 'TEST STREAM - Development',
      started_at: new Date().toISOString(),
      ended_at: null
    }
  },
  'go-offline': {
    type: 'livestream.status.updated',
    payload: {
      broadcaster: { user_id: 1, username: 'your_channel', is_anonymous: false, is_verified: true, profile_picture: '', channel_slug: 'your_channel', identity: null },
      is_live: false,
      title: 'TEST STREAM - Development',
      started_at: new Date(Date.now() - 3600000).toISOString(),
      ended_at: new Date().toISOString()
    }
  },
  'chat': {
    type: 'chat.message.sent',
    payload: {
      message_id: 'test_msg_' + Date.now(),
      broadcaster: { user_id: 1, username: 'your_channel', is_anonymous: false, is_verified: true, profile_picture: '', channel_slug: 'your_channel', identity: null },
      sender: { user_id: 444, username: 'chatty_viewer', is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: 'chatty_viewer', identity: { username_color: '#FF5733', badges: [{ text: 'Subscriber', type: 'subscriber', count: 3 }] } },
      content: 'This is a test chat message! PogChamp',
      emotes: [],
      created_at: new Date().toISOString()
    }
  }
};

// Hype train: rapid-fire 10 subs in 5 seconds
const sequences = {
  'hype-train': async () => {
    console.log('Starting hype train: 10 subs in 5 seconds...');
    for (let i = 0; i < 10; i++) {
      const payload = { ...events['new-sub'].payload };
      payload.subscriber = { ...payload.subscriber, user_id: 1000 + i, username: `hype_viewer_${i + 1}` };
      await sendEvent('channel.subscription.new', payload);
      console.log(`  Sub ${i + 1}/10 sent`);
      await new Promise(r => setTimeout(r, 500));
    }
    console.log('Hype train complete!');
  },
  'gift-bomb': async () => {
    console.log('Sending gift bomb: 25 gifted subs...');
    const payload = { ...events['gifted-sub'].payload };
    payload.giftees = Array.from({ length: 25 }, (_, i) => ({
      user_id: 2000 + i, username: `gift_recipient_${i + 1}`, is_anonymous: false, is_verified: false, profile_picture: '', channel_slug: `recipient_${i + 1}`, identity: null
    }));
    payload.gifter.username = 'mega_gifter';
    await sendEvent('channel.subscription.gifts', payload);
    console.log('Gift bomb sent!');
  },
  'all': async () => {
    console.log('Sending one of each event type...');
    for (const [name, event] of Object.entries(events)) {
      await sendEvent(event.type, event.payload);
      console.log(`  Sent: ${name}`);
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('All events sent!');
  }
};

function sendEvent(type, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(`${BASE}/api/webhook/${USER_ID}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Kick-Event-Type': type,
        'Kick-Event-Version': '1',
        'Kick-Event-Subscription-Id': 'test-sub-' + Date.now(),
        'Kick-Event-Message-Id': 'test-msg-' + Date.now(),
        'Kick-Event-Message-Timestamp': new Date().toISOString(),
        'X-Kick-Signature': 'SKIP_VALIDATION_IN_DEV'
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Run
const eventName = process.argv[2];
if (!eventName) {
  console.log('StreamDeck Test Harness');
  console.log('======================');
  console.log('Usage: node test-events.js <event> [user-id]');
  console.log('');
  console.log('Single events:');
  Object.keys(events).forEach(name => console.log(`  ${name}`));
  console.log('');
  console.log('Sequences:');
  Object.keys(sequences).forEach(name => console.log(`  ${name}`));
  console.log('');
  console.log('Examples:');
  console.log('  node test-events.js new-sub');
  console.log('  node test-events.js gifted-sub my-user-uuid');
  console.log('  node test-events.js hype-train');
  console.log('  node test-events.js all');
} else if (sequences[eventName]) {
  sequences[eventName]();
} else if (events[eventName]) {
  sendEvent(events[eventName].type, events[eventName].payload)
    .then(r => console.log(`Sent ${eventName}: ${r.status}`))
    .catch(e => console.error('Error:', e.message));
} else {
  console.error(`Unknown event: ${eventName}`);
}
```

### How to use during development:
```bash
# Terminal 1: run your server
node server.js

# Terminal 2: send test events
node test-events.js new-sub          # Single new sub
node test-events.js gifted-sub       # 5 gifted subs
node test-events.js hype-train       # 10 subs in 5 seconds (stress test)
node test-events.js gift-bomb        # 25 gifted subs at once
node test-events.js all              # One of each event type
```

> **Important**: In development mode, your webhook handler should SKIP signature validation when it sees the `X-Kick-Signature: SKIP_VALIDATION_IN_DEV` header. Never allow this in production.

---

## PART 5: Known Kick API Issues & Gotchas

These are real issues reported in Kick's GitHub issues. Plan around them.

### 1. Webhook fires even when gift sub payment fails
**Issue**: Kick sends `channel.subscription.gifts` webhooks even when the payment is declined. You may get events for subs that didn't actually go through.
**Mitigation**: Consider adding a small delay (2-3 seconds) before processing gift sub events, or add a "pending confirmation" state. For now, process immediately but make the action revertable (which we already do via the undo system).

### 2. Subscription renewal webhooks don't fire when user adds a message
**Issue**: `channel.subscription.renewal` webhooks are only sent when the subscriber does NOT include a message with their resub. If they add a message, the event may not fire.
**Mitigation**: Don't rely solely on renewal events for critical features like countdown or goals. New subs and gifted subs are more reliable. Treat renewal events as a bonus.

### 3. Chat message webhooks can be intermittent
**Issue**: `chat.message.sent` webhooks may stop delivering after a few messages, especially for unverified apps.
**Mitigation**: Use chat events only for the chat ticker overlay (nice-to-have). Don't build critical features on chat webhooks. The ticker should degrade gracefully when messages stop arriving.

### 4. Webhook URL must be HTTPS with a valid certificate
**Issue**: Kick requires a publicly accessible HTTPS URL for webhooks. Self-signed certificates don't work.
**Mitigation**: Use ngrok (free HTTPS) for local dev. Use Vercel (automatic HTTPS) for production.

### 5. Kick auto-unsubscribes on failed delivery
**Issue**: If your server returns non-200 three times in a row, Kick silently unsubscribes the event. You won't get notified — events just stop.
**Mitigation**: Always return 200 immediately, then process the event asynchronously. Add a health check that periodically calls `GET /events/subscriptions` to verify your subscriptions are still active, and re-subscribes if any are missing.

### 6. Refresh tokens change on every use
**Issue**: When you refresh an access token, Kick also issues a new refresh token. You must store the new refresh token — the old one is invalidated.
**Mitigation**: In your token refresh logic, always update both the access token AND the refresh token in the database.

### 7. OAuth redirect URI must match exactly
**Issue**: Kick uses Next.js internally, which converts `127.0.0.1` to `localhost` in URLs. If your callback is registered as `http://127.0.0.1:3000/callback` but Kick converts it to `localhost`, the redirect fails.
**Mitigation**: Always use `localhost` (not 127.0.0.1) in your callback URL.

---

## PART 6: Edge Cases to Handle

### Co-op edge cases
| Scenario | Expected behavior |
|----------|-------------------|
| Co-op partner goes offline (WebSocket disconnects) | Shared countdown keeps ticking on the server. When partner reconnects, they receive the current state. No data loss. |
| Both streamers undo the same shared event simultaneously | First undo wins. Second undo gets a "already reverted" response. Conflict resolution: server-side, last-write-wins with optimistic locking. |
| Co-op session creator leaves mid-stream | Session stays active for the remaining member. They can continue using shared state or dissolve the session. |
| One streamer disables co-op countdown mid-stream | Their overlay switches back to personal countdown (or hides it). The shared countdown continues for the partner. The leaving streamer's events no longer add time to the shared timer. |
| Webhook arrives for a user whose session expired | Server refreshes the token automatically. If refresh fails, events still process (webhooks use a separate token from the user session). |

### Countdown edge cases
| Scenario | Expected behavior |
|----------|-------------------|
| Timer at 23:59:50 and a 30s sub comes in (max cap 24:00:00) | Timer clamped to 24:00:00. Undo entry records only the 10s that was actually added, not the full 30s. |
| 50 subs arrive in 2 seconds (hype train) | All 50 are processed sequentially. Each adds time. The "+Xs" overlay chips are batched — show the total aggregate "+25:00 from hype train" instead of 50 individual chips. |
| Timer hits zero while events are in the queue | Timer stops at minFloor. Queued events are still processed (time is added, restarting the timer from zero). The "TIME'S UP" animation plays, then immediately transitions to the countdown resuming if time was added. |
| Server restarts mid-countdown | On restart, reload countdown state from Supabase. Calculate elapsed time since last save. Resume ticking. There may be a gap of a few seconds. |

### Alert queue edge cases
| Scenario | Expected behavior |
|----------|-------------------|
| 20 alerts queued during a gift bomb | Queue has max size of 50. Alerts play sequentially. Dashboard shows the full queue with ability to skip/clear. After the queue drains, the cooldown resets. |
| Streamer skips current alert while it's mid-animation | Alert gets an immediate exit animation (fast fade, 100ms). Next alert starts after a 200ms gap. |
| Alert arrives while overlay is hidden (element toggled off) | Alert is queued but not displayed. When the alert box is toggled back on, queued alerts play. |

### Auth edge cases
| Scenario | Expected behavior |
|----------|-------------------|
| Mod logs in but their assigned streamer hasn't logged in yet | Mod sees a "waiting for streamer" state. They can't control anything until the streamer logs in and creates their overlay config. |
| Access token expires during a stream | Server attempts silent refresh using the refresh token. If refresh fails, the session continues (overlay still works) but webhook subscriptions may need re-registration. Dashboard shows a "reconnect Kick" banner. |
| Two browser tabs open for the same dashboard | Both connect via WebSocket. Both receive state updates. Commands from either tab work. No conflict — last write wins. |

---

## PART 7: Quick Reference Card

### Kick API Endpoints
```
OAuth authorize:    GET  https://id.kick.com/oauth/authorize
OAuth token:        POST https://id.kick.com/oauth/token
OAuth revoke:       POST https://id.kick.com/oauth/revoke
Get user:           GET  https://api.kick.com/public/v1/users
Get channel:        GET  https://api.kick.com/public/v1/channels?broadcaster_user_id=X
Subscribe events:   POST https://api.kick.com/public/v1/events/subscriptions
Get subscriptions:  GET  https://api.kick.com/public/v1/events/subscriptions
Public key:         GET  https://api.kick.com/public/v1/public-key
```

### OAuth scopes
```
user:read           Read user profile
channel:read        Read channel info
events:subscribe    Subscribe to webhook events
chat:write          Send chat messages
```

### Webhook event types
```
chat.message.sent              Chat message
channel.followed               New follower
channel.subscription.new       New subscriber
channel.subscription.gifts     Gifted subscriptions
channel.subscription.renewal   Sub renewal
livestream.status.updated      Stream online/offline
kicks.gifted                   Kicks native gift
```

### Project commands
```bash
node server.js                    # Start server (local)
node test-events.js all           # Send all test events
node test-events.js hype-train    # Stress test: 10 subs in 5s
node test-events.js gift-bomb     # Stress test: 25 gifts at once
ngrok http 3000                   # Expose local server for webhooks
```
