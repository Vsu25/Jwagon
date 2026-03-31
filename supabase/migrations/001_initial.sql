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
