const supabase = require('./supabase');

// Minimal cache. On Vercel, this cache may clear between requests, 
// so we will rely more on fetching directly if not found.
const coopState = new Map(); // sessionId -> { ...sessionData }
const userToSession = new Map(); // userId -> sessionId

async function loadSession(sessionId) {
  if (coopState.has(sessionId)) return coopState.get(sessionId);
  if (!supabase) return null;
  
  const { data, error } = await supabase
    .from('coop_sessions')
    .select('*, coop_members(*)')
    .eq('id', sessionId)
    .single();
    
  if (data) {
     coopState.set(sessionId, data);
     return data;
  }
  return null;
}

async function getMembers(sessionId) {
   const session = await loadSession(sessionId);
   return session ? session.coop_members.map(m => m.user_id) : [];
}

async function fetchUserSessionId(userId) {
   if (userToSession.has(userId)) return userToSession.get(userId);
   if (!supabase) return null;

   const { data } = await supabase
     .from('coop_members')
     .select('session_id')
     .eq('user_id', userId)
     .single();

   if (data) {
     userToSession.set(userId, data.session_id);
     return data.session_id;
   }
   return null;
}

// Establishes a 2-person session instantly
async function establishCoop(userId, partnerName) {
  if (!supabase) return { error: "Supabase not connected" };

  // 1. Find the partner by exact Kick username (case insensitive)
  const { data: partner } = await supabase
    .from('users')
    .select('id, kick_username')
    .ilike('kick_username', partnerName)
    .single();
    
  if (!partner) return { error: `User '${partnerName}' not found or hasn't logged in yet.` };
  if (partner.id === userId) return { error: "You cannot co-op with yourself." };

  // 2. Check if either is already in a session
  const userCurrent = await fetchUserSessionId(userId);
  const partnerCurrent = await fetchUserSessionId(partner.id);
  
  if (userCurrent) return { error: "You are already in a co-op session." };
  if (partnerCurrent) return { error: `User '${partnerName}' is already in an active co-op session.` };

  // 3. Create the Session
  const { data: session, error: sErr } = await supabase
    .from('coop_sessions')
    .insert([{
      name: `${partner.kick_username} Collab`, 
      created_by: userId
    }])
    .select().single();
    
  if (sErr || !session) return { error: "Failed to create session." };
  
  // 4. Link Both Members
  const { error: mErr } = await supabase
    .from('coop_members')
    .insert([
      { session_id: session.id, user_id: userId, share_countdown: true, share_goals: true },
      { session_id: session.id, user_id: partner.id, share_countdown: true, share_goals: true }
    ]);
    
  if (mErr) {
    // Cleanup if linking fails
    await supabase.from('coop_sessions').delete().eq('id', session.id);
    return { error: "Failed to link members." };
  }
  
  // Update Cache
  userToSession.set(userId, session.id);
  userToSession.set(partner.id, session.id);
  
  const { broadcast } = require('../server');
  // Broadcast to both so their dashboard/overlay can update!
  await broadcast({ type: 'coop:update', data: { status: 'active', partnerId: partner.id, partnerName: partner.kick_username } }, [userId, partner.id]);

  return { success: true, sessionId: session.id };
}

async function leaveCoop(userId) {
  const sessionId = await fetchUserSessionId(userId);
  if (!sessionId) return { error: "Not in a session." };

  // Because of ON DELETE CASCADE, deleting the session deletes the members
  await supabase.from('coop_sessions').delete().eq('id', sessionId);
  
  const members = await getMembers(sessionId);
  for (const m of members) {
    userToSession.delete(m);
  }
  coopState.delete(sessionId);

  const { broadcast } = require('../server');
  await broadcast({ type: 'coop:update', data: { status: 'inactive' } }, members);
  
  return { success: true };
}

async function toggleSharing(userId, shareCountdown, shareGoals) {
  const sessionId = await fetchUserSessionId(userId);
  if (!sessionId) return { error: "Not in a session." };

  const { error } = await supabase
    .from('coop_members')
    .update({ share_countdown: shareCountdown, share_goals: shareGoals })
    .eq('session_id', sessionId)
    .eq('user_id', userId);

  if (error) return { error: "Failed to update preferences." };

  // Invalidate cache so it triggers fresh fetch next time an event happens
  coopState.delete(sessionId);
  return { success: true };
}

async function getStatusForUser(userId) {
  const sessionId = await fetchUserSessionId(userId);
  if (!sessionId) return { active: false };

  const session = await loadSession(sessionId);
  if (!session) return { active: false };

  const partnerMember = session.coop_members.find(m => m.user_id !== userId);
  const myMember = session.coop_members.find(m => m.user_id === userId);

  let partnerName = 'Unknown';
  if (partnerMember) {
      const { data } = await supabase.from('users').select('kick_username').eq('id', partnerMember.user_id).single();
      if (data) partnerName = data.kick_username;
  }

  return {
    active: true,
    sessionId: session.id,
    partnerName,
    myPrefs: myMember ? {
      shareCountdown: myMember.share_countdown,
      shareGoals: myMember.share_goals
    } : null
  };
}

module.exports = { 
  loadSession, 
  getMembers, 
  establishCoop, 
  leaveCoop, 
  toggleSharing,
  getStatusForUser,
  fetchUserSessionId,
  coopState 
};
