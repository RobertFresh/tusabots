// TusaBot chat function — Supabase auth, memory, Anthropic Claude
// Phase 1: workspace scoping + lightweight command parsing
const { validateAuth, getUserId } = require('./auth-validate.js');
const { buildContext } = require('../../orchestrator/buildContext');
const { saveMessage, retrieveMemory } = require('../../memory/retrieveMemory');

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
      // Allowlist: extend this list as workspaces are created
      const ALLOWED = ['default', 'work', 'personal', 'tusabot', 'deploy-notes'];
      if (ALLOWED.includes(name)) {
        return { action: 'switch', workspace: name };
      }
      return { action: 'switch', workspace: name }; // return anyway; allowlist is soft
    }
  }
  return null;
}

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

  // Step 1: Authenticate
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
  let workspaceId = 'default';
  try {
    const body = JSON.parse(event.body);
    message = body.message;
    history = Array.isArray(body.history) ? body.history : [];
    workspaceId = typeof body.workspaceId === 'string' && body.workspaceId.length > 0
      ? body.workspaceId
      : 'default';
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'No message provided.' }) };

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
    return { statusCode: 500, body: JSON.stringify({ error: 'API error', detail: err }) };
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