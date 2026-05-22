// TusaBot chat function — Supabase auth, memory, Anthropic Claude
// Updated to use modular orchestrator layer.
const { validateAuth, getUserId } = require('./auth-validate.js');
const { buildContext } = require('../../orchestrator/buildContext');
const { saveMessage } = require('../../memory/retrieveMemory');

// ─── Main handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // ── Runtime env validation (observational only) ──
  console.log('[env] SUPABASE_URL present:', !!process.env.SUPABASE_URL);
  console.log('[env] SUPABASE_SERVICE_ROLE_KEY present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[FATAL ENV] Missing Supabase admin credentials — memory/storage WILL FAIL');
  }

  // Step 1: Authenticate — reject if token is missing or invalid
  const authResult = await validateAuth(event);
  if (authResult.user === null) {
    return { statusCode: authResult.statusCode, body: authResult.body };
  }
  const userId = getUserId(authResult.user) || authResult.user.user?.id || authResult.user.user?.sub;
  console.log('[chat] userId:', userId);

  // Step 2: Validate required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Claude API key not configured. Set it in Netlify environment variables.' })
    };
  }

  // Step 3: Parse request
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

  // Step 4: Build context (system prompt + memory + history + current message)
  const { system, messages } = await buildContext({ userId, currentMessage: message, conversationHistory: history });

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
      system,
      messages
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