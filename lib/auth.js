const axios = require('axios');
const crypto = require('crypto');
const supabase = require('./supabase');

function base64URLEncode(str) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier() {
  return base64URLEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier) {
  return base64URLEncode(crypto.createHash('sha256').update(verifier).digest());
}

function setupAuthRoutes(app) {
  app.get('/api/auth/kick', (req, res) => {
    const code_verifier = generateCodeVerifier();
    const code_challenge = generateCodeChallenge(code_verifier);
    
    req.session.code_verifier = code_verifier;
    req.session.state = crypto.randomBytes(16).toString('hex');
    
    const params = new URLSearchParams({
      client_id: process.env.KICK_CLIENT_ID,
      redirect_uri: `${process.env.BASE_URL}/api/auth/callback`,
      response_type: 'code',
      scope: 'user:read channel:read events:subscribe chat:write',
      code_challenge: code_challenge,
      code_challenge_method: 'S256',
      state: req.session.state
    });
    
    res.redirect(`https://id.kick.com/oauth/authorize?${params.toString()}`);
  });

  app.get('/api/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!req.session.state || state !== req.session.state) {
      return res.status(400).send('Invalid state');
    }
    
    try {
      const tokenRes = await axios.post('https://id.kick.com/oauth/token', new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        code: code,
        redirect_uri: `${process.env.BASE_URL}/api/auth/callback`,
        code_verifier: req.session.code_verifier
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      
      const { access_token, refresh_token, expires_in } = tokenRes.data;
      
      const userRes = await axios.get('https://api.kick.com/public/v1/users', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      });
      
      // Depending on API response structure, Kick returns user object or array. Assume object based on typical OAuth or array.
      // Usually it's an array if you fetch multiple, else just single obj. We will grab user id.
      let profile = Array.isArray(userRes.data) ? userRes.data[0] : userRes.data;
      if (userRes.data?.data) { // sometimes inside "data"
          profile = Array.isArray(userRes.data.data) ? userRes.data.data[0] : userRes.data.data;
      }
      
      if (!supabase) {
        req.session.userId = profile.user_id || profile.id;
        return res.redirect('/dashboard');
      }

      const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();
      const { data: user, error } = await supabase
        .from('users')
        .upsert({
          kick_user_id: profile.user_id || profile.id,
          kick_username: profile.name || profile.username || 'unknown',
          kick_avatar: profile.profile_picture || null,
          kick_channel_slug: (profile.name || profile.username || '').toLowerCase(),
          access_token: access_token,
          refresh_token: refresh_token,
          token_expires_at: expiresAt
        }, { onConflict: 'kick_user_id' })
        .select()
        .single();
        
      if (error) throw error;
      
      await subscribeToEvents(access_token);
      
      req.session.userId = user.id;
      req.session.kickUserId = user.kick_user_id;
      req.session.role = user.role;
      
      res.redirect('/dashboard');
    } catch (error) {
      console.error('OAuth Callback Error:', error.response?.data || error.message);
      res.status(500).send('Authentication failed');
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
  });

  // --- Moderator Management ---

  app.get('/api/moderators', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { data, error } = await supabase
        .from('moderator_assignments')
        .select('id, manager:manager_id(id, kick_username, kick_avatar)')
        .eq('streamer_id', req.session.userId);
      
      if (error) throw error;
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/moderators', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    try {
      // 1. Find user by kick_username (case insensitive)
      const { data: targetUser, error: userError } = await supabase
        .from('users')
        .select('id')
        .ilike('kick_username', username.trim())
        .single();
      
      if (userError || !targetUser) return res.status(404).json({ error: 'User not found in system. They must log in at least once.' });
      if (targetUser.id === req.session.userId) return res.status(400).json({ error: 'You cannot add yourself as a moderator.' });

      // 2. Assign
      const { error: assignError } = await supabase
        .from('moderator_assignments')
        .upsert({
          streamer_id: req.session.userId,
          manager_id: targetUser.id
        });
      
      if (assignError) throw assignError;
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/moderators/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { error } = await supabase
        .from('moderator_assignments')
        .delete()
        .eq('id', req.params.id)
        .eq('streamer_id', req.session.userId);
      
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/managed-channels', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { data, error } = await supabase
        .from('moderator_assignments')
        .select('streamer:streamer_id(id, kick_username, kick_avatar)')
        .eq('manager_id', req.session.userId);
      
      if (error) throw error;
      res.json(data.map(d => d.streamer));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

async function subscribeToEvents(access_token) {
  try {
    await axios.post('https://api.kick.com/public/v1/events/subscriptions', {
      events: [
        { name: 'chat.message.sent', version: 1 },
        { name: 'channel.followed', version: 1 },
        { name: 'channel.subscription.new', version: 1 },
        { name: 'channel.subscription.gifts', version: 1 },
        { name: 'channel.subscription.renewal', version: 1 },
        { name: 'livestream.status.updated', version: 1 },
        { name: 'kicks.gifted', version: 1 }
      ],
      method: 'webhook'
    }, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Successfully subscribed to Kick events.');
  } catch (err) {
    console.error('Webhook subscription failed:', err.response?.data || err.message);
  }
}

module.exports = { setupAuthRoutes };
