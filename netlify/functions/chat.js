// TusaBot chat function — Supabase auth, memory, Anthropic Claude
const { createClient } = require('@supabase/supabase-js');

const SYSTEM_PROMPT = "You are TusaBot, James's personal AI assistant. Be helpful, concise, and friendly.";

// ─── Auth: validate JWT, derive userId server-side ──────────────────────────

/**
 * Validates the Authorization: Bearer <token> header.
 * Returns the Supabase user object from the validated JWT.
 * Returns null and a 401 response if missing, invalid, or expired.
 *
 * @param {object} event - Netlify function event
 * @returns {Promise<{user: object|null, statusCode: number, body: string}>}
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
        tokenPrefix: token?.slice(0, 10) ?? null,
        supabaseError: null,
      })
    };
  }

  console.log('[auth] token prefix:', token?.slice(0, 20));

  // Read-only client with the anon key — we only use it to verify the JWT
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    // If env vars are missing, return a config error rather than a hard 500
    return {
      user: null,
      statusCode: 503,
      body: JSON.stringify({
        error: 'Server misconfiguration. Supabase env vars not set.',
        authHeaderPresent: !!authHeader,
        bearerPrefixPresent: !!bearerPresent,
        tokenPrefix: token?.slice(0, 10) ?? null,
        supabaseError: null,
      })
    };
  }

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
      })
    };
  }

  return { user, statusCode: null, body: null };
}

// ─── Supabase memory layer (server-side only) ───────────────────────────────

const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

if (!supabaseAdmin) {
  console.error('[FATAL] supabaseAdmin not initialised. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

async function getMemory(userId, limit = 20) {
  if (!supabaseAdmin) {
    console.error('[memory] getMemory skipped — supabaseAdmin null');
    return [];
  }
  const { data } = await supabaseAdmin
    .from('messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  console.log('[memory/read]', userId, data?.length);
  return (data || []).reverse();
}

async function saveMessage(userId, role, content) {
  if (!supabaseAdmin) {
    console.error('[memory] saveMessage skipped — supabaseAdmin null');
    return;
  }
  console.log('[memory/write]', userId, content);
  await supabaseAdmin.from('messages').insert({ user_id: userId, role, content });
}

// ─── Main handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // ── Runtime env validation (observational only) ──
  console.log('[env] SUPABASE_URL present:', !!process.env.SUPABASE_URL);
  console.log('[env] SUPABASE_SERVICE_ROLE_KEY present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log('[env] VITE_SUPABASE_URL present:', !!process.env.VITE_SUPABASE_URL);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[FATAL ENV] Missing Supabase admin credentials — memory/storage WILL FAIL');
  }

  // Step 1: Authenticate — reject if token is missing or invalid
  const authResult = await validateAuth(event);
  if (authResult.user === null) {
    return { statusCode: authResult.statusCode, body: authResult.body };
  }
  const userId = authResult.user.user?.id || authResult.user.user?.sub; // Derived from validated JWT — never from client body
  console.log('[chat] userId:', userId);

  // Step 2: Validate required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Claude API key not configured. Set it in Netlify environment variables.' })
    };
  }

  // Step 3: Parse request — userId from body is now ignored; identity is server-derived
  let message;
  let history = [];
  try {
    const body = JSON.parse(event.body);
    message = body.message;
    history = Array.isArray(body.history) ? body.history : [];
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'No message provided.' }) };

  // Step 4: Load memory for this user
  const prior = await getMemory(userId);
  prior.push({ role: 'user', content: message });

  // Step 5: Call Claude
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: prior
    })
  });

  if (!res.ok) {
    const err = await res.text();
    return { statusCode: 500, body: JSON.stringify({ error: 'API error', detail: err }) };
  }

  const data = await res.json();
  const reply = data.content[0].text;

  // Step 6: Save memory (fire-and-forget — don't block the response)
  saveMessage(userId, 'user', message).catch(err => console.error('[chat/saveMessage FAILED]', err));
  saveMessage(userId, 'assistant', reply).catch(err => console.error('[chat/saveMessage FAILED]', err));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply })
  };
};