// lib/auth-validate.js
// Shared JWT validation for TusaBots Netlify functions.
// Validates Bearer token against Supabase, returns user object or error response.

/**
 * @param {object} event — Netlify function event
 * @returns {{user: object|null, statusCode: number, body: string|null}}
 */
async function validateAuth(event) {
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  const bearerPresent = authHeader?.startsWith('Bearer ');
  const token = bearerPresent ? authHeader.slice(7) : null;

  console.log('[auth] auth header present:', !!authHeader, 'bearer:', !!bearerPresent);

  if (!authHeader || !bearerPresent) {
    console.error('[auth] missing or malformed Authorization header');
    return {
      user: null,
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized.' }),
    };
  }

  console.log('[auth] token present:', !!token);

  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    console.error('[auth] FATAL: Supabase env vars not set');
    return {
      user: null,
      statusCode: 503,
      body: JSON.stringify({ error: 'Service temporarily unavailable.' }),
    };
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
  );

  const { data: user, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error('[auth] getUser failed:', error?.message, 'token present:', !!token);
    return {
      user: null,
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized.' }),
    };
  }

  return { user, statusCode: null, body: null };
}

/**
 * Extracts the canonical userId from a validated Supabase user object.
 * getUser() returns { user: { id, sub, ... } } — not a flat object.
 * @param {object} userObj — the user object from validateAuth()
 * @returns {string|null}
 */
function getUserId(userObj) {
  return userObj?.user?.id || userObj?.user?.sub || null;
}

module.exports = { validateAuth, getUserId };