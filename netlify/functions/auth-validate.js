// lib/auth-validate.js
// Shared JWT validation for TusaBots Netlify functions.
// Validates Bearer token against Supabase, returns user object or error response.

/**
 * Parse cookies from a cookie header string.
 * @param {string} cookieHeader
 * @returns {object}
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

/**
 * @param {object} event — Netlify function event
 * @returns {{user: object|null, statusCode: number, body: string|null}}
 */
async function validateAuth(event) {
  // 1. Try httpOnly cookie first (new secure path)
  const cookies = parseCookies(event.headers['cookie']);
  let token = cookies['tusabots_access_token'] || null;

  // 2. Fall back to Authorization: Bearer header (backward compat during transition)
  if (!token) {
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return {
      user: null,
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized.' }),
    };
  }

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