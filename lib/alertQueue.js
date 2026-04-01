// AlertQueue - Disabled to save Vercel Hobby function calls
// Alerts are no longer rendered in the overlay. 
// This module is kept as a stub so existing imports don't break.

function enqueue(userId, eventType, payload) {
  // No-op: AlertBox removed from overlay
}

function skip(userId) {}
function clear(userId) {}

module.exports = { enqueue, skip, clear };
