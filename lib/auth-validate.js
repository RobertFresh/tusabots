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

  console.log('[auth] auth header present:', !!authHeader);

  if (!authHeader || !bearerPresent) {
    console.error('[auth] missing or malformed Authorization header');
    return {
      user: null,
      statusCode: 401,
      body: JSON.stringify({
        error: 'Unauthorized. No token provided.',
        authHeaderPresent: !!authHeader,
        bearerPrefixPresent: !!bearerPresent,
        tokenPrefix: null,
        supabaseError: null,
      }),
    };
  }

  console.log('[auth] token prefix:', token?.slice(0, 20));

  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    return {
      user: null,
      statusCode: 503,
      body: JSON.stringify({
        error: 'Server misconfiguration. Supabase env vars not set.',
        authHeaderPresent: !!authHeader,
        bearerPrefixPresent: !!bearerPresent,
        tokenPrefix: token?.slice(0, 10) ?? null,
        supabaseError: null,
      }),
    };
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
  );

  const { data: user, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error('[auth] getUser failed:', error?.message);
    return {
      user: null,
      statusCode: 401,
      body: JSON.stringify({
        error: 'Unauthorized. Invalid or expired token.',
        authHeaderPresent: !!authHeader,
        bearerPrefixPresent: !!bearerPresent,
        tokenPrefix: token?.slice(0, 10) ?? null,
        supabaseError: error?.message ?? null,
      }),
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