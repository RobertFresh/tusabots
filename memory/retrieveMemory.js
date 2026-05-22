// memory/retrieveMemory.js
// Modular memory retrieval layer.
// Fetches curated conversation history from Supabase for a given user.
// Designed to be lightweight — fetches last N messages only.

const { createClient } = require('@supabase/supabase-js');

// ─── Supabase admin client (server-side only) ────────────────────────────────

const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

if (!supabaseAdmin) {
  console.error('[memory] supabaseAdmin not initialised. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

/**
 * Retrieve recent curated messages for a user.
 * Returns messages in chronological order (oldest first) for direct use in a chat API.
 *
 * @param {string} userId - Supabase user ID
 * @param {number} [limit=20] - Maximum messages to retrieve (default: 20)
 * @returns {Promise<Array<{role: string, content: string}>>} - Ordered message array
 */
async function retrieveMemory(userId, limit = 20) {
  if (!supabaseAdmin) {
    console.error('[memory/retrieveMemory] skipped — supabaseAdmin null');
    return [];
  }

  if (!userId) {
    console.error('[memory/retrieveMemory] skipped — no userId provided');
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[memory/retrieveMemory] query failed:', error.message);
    return [];
  }

  console.log('[memory/retrieveMemory]', userId, '→', data?.length ?? 0, 'messages');
  return data || [];
}

/**
 * Save a single message to the conversation history.
 *
 * @param {string} userId - Supabase user ID
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message text
 * @returns {Promise<void>}
 */
async function saveMessage(userId, role, content) {
  if (!supabaseAdmin) {
    console.error('[memory/saveMessage] skipped — supabaseAdmin null');
    return;
  }

  if (!userId || !role || !content) {
    console.error('[memory/saveMessage] skipped — missing required arguments');
    return;
  }

  console.log('[memory/saveMessage]', userId, role, content.slice(0, 60));
  await supabaseAdmin.from('messages').insert({ user_id: userId, role, content });
}

module.exports = { retrieveMemory, saveMessage };