// TusaBot chat function — Supabase auth, memory, Anthropic Claude
// Phase 1: workspace scoping + lightweight command parsing
const { validateAuth, getUserId } = require('./auth-validate.js');
const { buildContext } = require('../../orchestrator/buildContext');
const { saveMessage, retrieveMemory, countRecentUserMessages } = require('../../memory/retrieveMemory');

// ─── Workspace command parser ────────────────────────────────────────────────
// Deterministic pattern matching — no AI involved.
// Supported forms:
//   "open <name> workspace"   → { action: 'switch', workspace: <name> }
//   "use <name> workspace"    → { action: 'switch', workspace: <name> }
//   "switch to <name>"        → { action: 'switch', workspace: <name> }
//   "switch to <name> workspace" → { action: 'switch', workspace: <name> }
// Returns null if no command pattern matches.
function parseWorkspaceCommand(message) {
  const text = message.trim();
  const patterns = [
    /^open\s+(\w[\w\-]*)\s+workspace$/i,
    /^use\s+(\w[\w\-]*)\s+workspace$/i,
    /^switch\s+to\s+(\w[\w\-]*(?:\s+\w+)*)\s+workspace$/i,
    /^switch\s+to\s+(\w[\w\-]*)$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].toLowerCase().replace(/\s+/g, '-');
      if (name === 'default') {
        return { action: 'switch', workspace: 'default' };
      }
      // Hard allowlist: reject unknown workspace names instead of accepting anything.
      const ALLOWED = ['default', 'work', 'personal', 'tusabot', 'deploy-notes'];
      if (ALLOWED.includes(name)) {
        return { action: 'switch', workspace: name };
      }
      return { action: 'reject', workspace: name };
    }
  }
  return null;
}

// ─── Main handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // CORS origin check
  const origin = event.headers['origin'] || '';
  const ALLOWED_ORIGINS = ['https://tusabots.netlify.app', 'https://tusabots.com', 'https://www.tusabots.com'];
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden.' }) };
  }

  // ── Runtime env validation ──
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[FATAL ENV] Missing Supabase admin credentials — memory/storage WILL FAIL');
  }

  // Step 1: Authenticate
  const authResult = await validateAuth(event);
  if (authResult.user === null) {
    return { statusCode: authResult.statusCode, body: authResult.body };
  }
  const userId = getUserId(authResult.user) || authResult.user.user?.id || authResult.user.user?.sub;

  // Step 2: Validate required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Claude API key not configured. Set it in Netlify environment variables.' })
    };
  }

  // Step 3: Parse request
  // NOTE: `body` is declared OUTSIDE the try block so it stays in scope for the
  // peekMode check below. (Previously it was a `const` inside the try, so it
  // vanished after the block and every request crashed with "Error: Unknown".)
  let body;
  let message;
  let history = [];
  let workspaceId = 'default';
  try {
    body = JSON.parse(event.body);
    message = body.message;
    // Sanitize history: keep only well-formed {role: user|assistant, content: string}
    // entries. Prevents a crafted client injecting role:'system' or junk into Claude.
    history = (Array.isArray(body.history) ? body.history : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20);
    // Validate workspaceId shape; fall back to 'default' for anything unexpected.
    workspaceId = (typeof body.workspaceId === 'string' && /^[a-z0-9-]{1,30}$/.test(body.workspaceId))
      ? body.workspaceId
      : 'default';
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  if (!message || message.length > 4000) return { statusCode: 400, body: JSON.stringify({ error: 'Message required (max 4000 chars).' }) };

  // ── Peek mode: return workspace-scoped history without saving or AI call ──
  if (body.peekMode === true) {
    const storedMessages = await retrieveMemory(userId, 20, workspaceId);
    console.log('[chat] peekMode → workspace:', workspaceId, 'messages:', storedMessages.length);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: storedMessages })
    };
  }

  // Step 4: Check for workspace command (before normal processing)
  const command = parseWorkspaceCommand(message);
  if (command && command.action === 'reject') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: `Unknown workspace: **${command.workspace}**. Staying put.` })
    };
  }
  if (command && command.action === 'switch') {
    const targetWorkspace = command.workspace;
    console.log('[chat] workspace command → switching to:', targetWorkspace);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply: `Switched to workspace: **${targetWorkspace}**. Context scope updated.`,
        workspaceSwitch: targetWorkspace,
      })
    };
  }

  // ── Per-user rate limit (protects the expensive Sonnet endpoint from abuse) ──
  // An authenticated user could otherwise fire unlimited 1024-token Sonnet calls.
  // We reach here only for a genuine chat turn (peekMode + workspace switches
  // already returned above), so the count gates exactly the paid requests.
  // Fails open on count error (never blocks a paying user because a count broke).
  const USER_MAX_PER_MIN = 15;
  const rlSinceIso = new Date(Date.now() - 60 * 1000).toISOString();
  const recentUserCount = await countRecentUserMessages(userId, rlSinceIso);
  if (recentUserCount >= USER_MAX_PER_MIN) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Too many messages. Please wait a moment.' })
    };
  }

  // Step 5: Build context (system prompt + workspace-scoped memory + history + current message)
  const { system, messages } = await buildContext({
    userId,
    currentMessage: message,
    conversationHistory: history,
    workspaceId,
  });

  // Step 6: Call Claude
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
    console.error('[chat] Claude API error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'AI service unavailable.' }) };
  }

  const data = await res.json();
  const reply = data.content[0].text;

  // Step 7: Save memory scoped to workspace (fire-and-forget)
  saveMessage(userId, 'user', message, workspaceId).catch(err => console.error('[chat/saveMessage FAILED]', err));
  saveMessage(userId, 'assistant', reply, workspaceId).catch(err => console.error('[chat/saveMessage FAILED]', err));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply })
  };
};