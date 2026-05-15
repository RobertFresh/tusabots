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
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      user: null,
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized. No token provided.' })
    };
  }

  const token = authHeader.slice(7); // strip "Bearer "

  // Read-only client with the anon key — we only use it to verify the JWT
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    // If env vars are missing, return a config error rather than a hard 500
    return {
      user: null,
      statusCode: 503,
      body: JSON.stringify({ error: 'Server misconfiguration. Supabase env vars not set.' })
    };
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
  );

  const { data: user, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return {
      user: null,
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized. Invalid or expired token.' })
    };
  }

  return { user, statusCode: null, body: null };
}

// ─── Supabase memory layer (server-side only) ───────────────────────────────

const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

async function getMemory(userId, limit = 20) {
  if (!supabaseAdmin) return [];
  const { data } = await supabaseAdmin
    .from('messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

async function saveMessage(userId, role, content) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from('messages').insert({ user_id: userId, role, content });
}

// ─── Main handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Step 1: Authenticate — reject if token is missing or invalid
  const authResult = await validateAuth(event);
  if (authResult.user === null) {
    return { statusCode: authResult.statusCode, body: authResult.body };
  }
  const userId = authResult.user.id; // Derived from validated JWT — never from client body

  // Step 2: Validate required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Claude API key not configured. Set ANTHROPIC_API_KEY in Netlify environment variables.' })
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
  saveMessage(userId, 'user', message).catch(() => {});
  saveMessage(userId, 'assistant', reply).catch(() => {});

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply })
  };
};