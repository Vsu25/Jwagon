const supabase = require('./supabase');
const { broadcast } = require('../server');

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

async function establishCoop(userId, partnerName) {
  if (!supabase) {
      console.warn("Supabase not linked - mocked coop connection");
      const fakeSessionId = 'test-session';
      userToSession.set(userId, fakeSessionId);
      coopState.set(fakeSessionId, {
          id: fakeSessionId,
          name: partnerName + ' Collab',
          shared_countdown: { currentMs: 3600000, config: { maxCap: 86400000 } },
          shared_goals: { currentCount: 0, list: [ { name: '!Coop Goal 1', targetCount: 15 } ] },
          coop_members: [
              { user_id: userId, share_countdown: true, share_goals: true },
              { user_id: 'partner-id', share_countdown: true, share_goals: true }
          ]
      });
      userToSession.set('partner-id', fakeSessionId);
      return;
  }

  // Find partner
  const { data: partner } = await supabase.from('users').select('id').ilike('kick_username', partnerName).single();
  if (!partner) return;

  const { data: session } = await supabase.from('coop_sessions').insert([{
    name: 'Co-op Session', created_by: userId
  }]).select().single();
  
  await supabase.from('coop_members').insert([
    { session_id: session.id, user_id: userId, share_countdown: true, share_goals: true },
    { session_id: session.id, user_id: partner.id, share_countdown: true, share_goals: true }
  ]);
  
  userToSession.set(userId, session.id);
  userToSession.set(partner.id, session.id);
  
  await broadcast({ type: 'coop:update', data: { status: 'active', partner: partnerName } }, [userId, partner.id]);
}

function getActiveSession(userId) {
    return userToSession.get(userId);
}

module.exports = { loadSession, getMembers, establishCoop, getActiveSession, coopState };
