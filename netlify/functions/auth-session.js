// netlify/functions/auth-session.js
// Handles auth actions (signin, signup, signout, refresh, session) and sets
// httpOnly cookies for access_token and refresh_token instead of returning
// them to the client.  This prevents XSS-based token theft.

const ALLOWED_ORIGINS = [
  'https://tusabots.netlify.app',
  'https://tusabots.com',
  'https://www.tusabots.com',
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function makeSetCookieHeaders(accessToken, refreshToken, clear = false) {
  const cookieOpts = 'HttpOnly; Secure; SameSite=Lax; Path=/';
  if (clear) {
    return [
      `tusabots_access_token=; ${cookieOpts}; Max-Age=0`,
      `tusabots_refresh_token=; ${cookieOpts}; Max-Age=0`,
    ];
  }
  const cookies = [];
  if (accessToken) {
    cookies.push(`tusabots_access_token=${encodeURIComponent(accessToken)}; ${cookieOpts}; Max-Age=3600`);
  }
  if (refreshToken) {
    cookies.push(`tusabots_refresh_token=${encodeURIComponent(refreshToken)}; ${cookieOpts}; Max-Age=604800`);
  }
  return cookies;
}

async function supabaseFetch(path, options = {}) {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase environment variables not configured');
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || body.error_description || body.msg || 'Supabase request failed');
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

exports.handler = async (event) => {
  const origin = event.headers['origin'] || '';
  const headers = corsHeaders(origin);

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { action } = parsed;

  try {
    // ── SIGN IN ──────────────────────────────────────────────────────────────
    if (action === 'signin') {
      const { email, password } = parsed;
      if (!email || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Email and password required' }),
        };
      }

      const data = await supabaseFetch('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      const setCookies = makeSetCookieHeaders(data.access_token, data.refresh_token);
      // Return user info (no tokens) so the client knows who logged in
      return {
        statusCode: 200,
        headers,
        multiValueHeaders: { 'Set-Cookie': setCookies },
        body: JSON.stringify({
          user: data.user,
          expires_at: data.expires_at,
        }),
      };
    }

    // ── SIGN UP ──────────────────────────────────────────────────────────────
    if (action === 'signup') {
      const { email, password } = parsed;
      if (!email || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Email and password required' }),
        };
      }

      const data = await supabaseFetch('/auth/v1/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      // Supabase may not return tokens for email-confirmation-required signups
      const setCookies = data.access_token
        ? makeSetCookieHeaders(data.access_token, data.refresh_token)
        : [];

      return {
        statusCode: 200,
        headers,
        ...(setCookies.length ? { multiValueHeaders: { 'Set-Cookie': setCookies } } : {}),
        body: JSON.stringify({
          user: data.user,
          expires_at: data.expires_at,
        }),
      };
    }

    // ── SIGN OUT ─────────────────────────────────────────────────────────────
    if (action === 'signout') {
      const cookies = parseCookies(event.headers['cookie']);
      const accessToken = cookies['tusabots_access_token'];

      // Best-effort logout at Supabase (invalidate the refresh token server-side)
      if (accessToken) {
        try {
          await supabaseFetch('/auth/v1/logout', {
            method: 'POST',
            bearer: accessToken,
          });
        } catch {
          // Ignore errors — we clear cookies regardless
        }
      }

      const setCookies = makeSetCookieHeaders(null, null, true);
      return {
        statusCode: 200,
        headers,
        multiValueHeaders: { 'Set-Cookie': setCookies },
        body: JSON.stringify({ ok: true }),
      };
    }

    // ── REFRESH ──────────────────────────────────────────────────────────────
    if (action === 'refresh') {
      const cookies = parseCookies(event.headers['cookie']);
      const refreshToken = cookies['tusabots_refresh_token'];

      if (!refreshToken) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'No refresh token' }),
        };
      }

      const data = await supabaseFetch('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      const setCookies = makeSetCookieHeaders(data.access_token, data.refresh_token);
      return {
        statusCode: 200,
        headers,
        multiValueHeaders: { 'Set-Cookie': setCookies },
        body: JSON.stringify({
          user: data.user,
          expires_at: data.expires_at,
        }),
      };
    }

    // ── SESSION (validate current access token, return user) ─────────────────
    if (action === 'session') {
      const cookies = parseCookies(event.headers['cookie']);
      const accessToken = cookies['tusabots_access_token'];

      if (!accessToken) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'No session' }),
        };
      }

      // Validate with Supabase
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
        process.env.VITE_SUPABASE_ANON_KEY
      );

      const { data: userData, error } = await supabase.auth.getUser(accessToken);

      if (error || !userData?.user) {
        // Token might be expired — try refreshing
        const refreshToken = cookies['tusabots_refresh_token'];
        if (refreshToken) {
          try {
            const refreshed = await supabaseFetch('/auth/v1/token?grant_type=refresh_token', {
              method: 'POST',
              body: JSON.stringify({ refresh_token: refreshToken }),
            });
            const setCookies = makeSetCookieHeaders(refreshed.access_token, refreshed.refresh_token);
            return {
              statusCode: 200,
              headers,
              multiValueHeaders: { 'Set-Cookie': setCookies },
              body: JSON.stringify({
                user: refreshed.user,
                expires_at: refreshed.expires_at,
              }),
            };
          } catch {
            // Refresh also failed — session is truly dead
          }
        }
        const clearCookies = makeSetCookieHeaders(null, null, true);
        return {
          statusCode: 401,
          headers,
          multiValueHeaders: { 'Set-Cookie': clearCookies },
          body: JSON.stringify({ error: 'Session expired' }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ user: userData.user }),
      };
    }

    // ── Unknown action ───────────────────────────────────────────────────────
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: `Unknown action: ${action}` }),
    };
  } catch (err) {
    console.error('[auth-session] Error:', err.message);
    return {
      statusCode: err.status || 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Internal error' }),
    };
  }
};
