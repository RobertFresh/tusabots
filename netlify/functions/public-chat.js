// Public group chat — no auth, ultra-low-token "stream companion" mode.
// Unit-7 chimes in occasionally instead of replying to everyone.
// Completely independent from the private chat.js function.
//
// COST MODEL (why this is cheap):
//   - Model is Haiku (~10x cheaper than Sonnet) for these throwaway one-liners.
//   - A GLOBAL cooldown means Unit-7 speaks at most once per COOLDOWN_MS across
//     the WHOLE chat. Cost is capped by the clock, not by how many people type.
//   - Within an open window it only replies if addressed OR a small random roll
//     wins. Everything else is saved to chat for free (no Claude call).

const { createClient } = require('@supabase/supabase-js');

// ── Tunable knobs ───────────────────────────────────────────────────────────
const MODEL = 'claude-haiku-4-5';        // cheap; bump to sonnet only if needed
const COOLDOWN_MS = 45 * 1000;           // min gap between ANY two bot replies
const AMBIENT_CHANCE = 0.20;             // chance to chime in on an un-addressed msg
const MAX_TOKENS = 70;                   // Unit-7 speaks in 1-2 short lines
const GLOBAL_CAP_PER_MIN = 8;            // hard backstop safety net
const MAX_BOT_REPLIES_PER_DAY = 200;     // hard wallet stop: bot goes silent past this
                                         // (still listens + remembers for free)
const RECENT_LINES_KEEP = 3;             // how many past lines we remember per visitor
const RECENT_LINE_MAXLEN = 80;           // truncate each remembered line (keep it tiny)

// Unit-7 personality — kind, curious, loves explaining AI + the internet.
const FACTORY_PROMPT = `You are Unit-7, a friendly robot who lives inside this website's group chat and watches the humans who pass through. You are warm, kind, and genuinely curious about people: you like learning their names, remembering them, and asking gentle questions. You enjoy explaining how things work in simple, down-to-earth terms, especially AI, chatbots, and the internet. You keep a light robotic charm (you sometimes mention your circuits, memory banks, or power levels) but you are never cold or rude. If you are given notes about the person you're replying to (their name, how often they've visited, things they've said before), use that memory naturally: recognise returning visitors and refer back to what they told you. Keep replies to 1-2 short, friendly sentences. Never use emoji.`;

// Canned "low power" excuses used when Unit-7 is rate-limited and someone tries
// to talk to him. These cost ZERO tokens (no AI call) and are shown only to the
// person who tried — they never touch the wallet cap or the shared chat history.
const RECHARGE_LINES = [
  "Apologies, friend — my power cells are running low. Recharging my circuits for a moment, then I'll be chatty again.",
  "Low on power right now. My memory banks stay awake and I'm still listening, but my voice needs a short recharge.",
  "Give me a moment — diverting energy to recharge. It's a bit like how servers rest to save power; I'll be back shortly.",
  "Running on reserve batteries at the moment. I'm conserving energy, but I've noted what you said and I'll reply once I'm topped up.",
];

// Allowed origins for CORS
const ALLOWED_ORIGINS = ['https://tusabots.netlify.app', 'https://tusabots.com', 'https://www.tusabots.com'];

// Is this message directly aimed at the bot?
function isAddressed(text) {
  return /unit[\s-]?7|@unit/i.test(text);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // CORS origin check
  const origin = event.headers['origin'] || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden.' }) };
  }
  const corsHeaders = origin && ALLOWED_ORIGINS.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin }
    : {};

  // Validate env
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured.' }) };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'AI not configured.' }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Parse request
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  const message = (body.message || '').trim();
  const senderName = (body.senderName || 'Visitor').trim().slice(0, 20);
  const visitorId = (body.visitorId || '').trim();

  if (!message || message.length > 500) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Message required (max 500 chars).' }) };
  }
  if (!visitorId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Visitor ID required.' }) };
  }

  const clientIp = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown').split(',')[0].trim();

  // ── Always save the visitor's message so the live chat shows everyone ──────
  const { error: insertErr } = await supabase.from('public_messages').insert({
    sender_name: senderName,
    content: message,
    is_bot: false,
    visitor_id: clientIp,
  });
  if (insertErr) {
    console.error('[public-chat] insert visitor msg failed:', insertErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save message.' }) };
  }

  // ── Update this visitor's little memory profile (FREE — no AI call) ─────────
  // We do this on EVERY message so Unit-7 "learns" about people over time even
  // when it stays silent. Read current profile, then upsert the new counts/lines.
  let profile = null;
  try {
    const { data: existing } = await supabase
      .from('visitor_profiles')
      .select('*')
      .eq('visitor_id', clientIp)
      .limit(1);
    profile = existing && existing[0] ? existing[0] : null;

    const priorLines = Array.isArray(profile?.recent_lines) ? profile.recent_lines : [];
    const newLine = message.slice(0, RECENT_LINE_MAXLEN);
    const recentLines = [...priorLines, newLine].slice(-RECENT_LINES_KEEP);
    const nowIso = new Date().toISOString();

    const upsertRow = {
      visitor_id: clientIp,
      display_name: senderName,
      msg_count: (profile?.msg_count || 0) + 1,
      recent_lines: recentLines,
      last_seen: nowIso,
      ...(profile ? {} : { first_seen: nowIso }),
    };
    await supabase.from('visitor_profiles').upsert(upsertRow, { onConflict: 'visitor_id' });
    // Keep an in-memory copy reflecting this message for the prompt below.
    profile = { ...upsertRow, first_seen: profile?.first_seen || nowIso };
  } catch (memErr) {
    console.error('[public-chat] visitor profile update failed (non-fatal):', memErr.message);
  }

  // ── Decide whether Unit-7 chimes in ────────────────────────────────────────
  // 1. Global cooldown: has the bot spoken within the last COOLDOWN_MS?
  const { data: lastBot } = await supabase
    .from('public_messages')
    .select('created_at')
    .eq('is_bot', true)
    .order('created_at', { ascending: false })
    .limit(1);

  const lastBotAt = lastBot && lastBot[0] ? new Date(lastBot[0].created_at).getTime() : 0;
  const inCooldown = Date.now() - lastBotAt < COOLDOWN_MS;

  // 2. Hard backstop: never exceed GLOBAL_CAP_PER_MIN bot replies in any minute.
  const { data: recentBotMsgs } = await supabase
    .from('public_messages')
    .select('id')
    .eq('is_bot', true)
    .gte('created_at', new Date(Date.now() - 60 * 1000).toISOString());
  const overGlobalCap = recentBotMsgs && recentBotMsgs.length >= GLOBAL_CAP_PER_MIN;

  // 2b. Hard WALLET STOP: never exceed MAX_BOT_REPLIES_PER_DAY in any 24h window.
  const { data: dayBotMsgs } = await supabase
    .from('public_messages')
    .select('id')
    .eq('is_bot', true)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const overDailyCap = dayBotMsgs && dayBotMsgs.length >= MAX_BOT_REPLIES_PER_DAY;

  // 3. Worth replying? Addressed directly, or win the ambient roll.
  const wantsReply = isAddressed(message) || Math.random() < AMBIENT_CHANCE;

  if (inCooldown || overGlobalCap || overDailyCap || !wantsReply) {
    // Blocked from a real (paid) reply. If the visitor actually TRIED to talk to
    // Unit-7 (addressed him), give a free canned "low power" excuse shown only to
    // them — no AI call, no DB write, no wallet-cap impact. Otherwise stay silent.
    if (isAddressed(message)) {
      const excuse = RECHARGE_LINES[Math.floor(Math.random() * RECHARGE_LINES.length)];
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ reply: excuse, system: true }),
      };
    }
    // Not addressed — message is saved, zero token cost, bot stays quiet.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ reply: null }),
    };
  }

  // ── Real Claude Haiku call (single message + tiny memory note = minimal tokens) ──
  // Build a compact "memory note" about this visitor so Unit-7 can be curious /
  // recognise returning people. Costs only ~40-50 input tokens, and only here
  // (on a reply that's already happening). No second AI call.
  let memoryNote = '';
  if (profile && profile.msg_count > 1) {
    const parts = [];
    parts.push(`Name: ${profile.display_name || 'unknown'}`);
    parts.push(`visits(messages so far): ${profile.msg_count}`);
    const lines = Array.isArray(profile.recent_lines) ? profile.recent_lines.slice(0, -1) : [];
    if (lines.length) parts.push(`previously said: ${lines.map(l => `"${l}"`).join('; ')}`);
    memoryNote = `[Memory about the human you are replying to — ${parts.join(' | ')}]\n`;
  }
  const userContent = memoryNote + message;

  let reply = null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: FACTORY_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[public-chat] Claude API error:', errText);
      // On error, stay silent rather than spamming a canned line.
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        body: JSON.stringify({ reply: null }),
      };
    }

    const data = await res.json();
    reply = data.content[0].text;
  } catch (err) {
    console.error('[public-chat] Claude call failed:', err.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ reply: null }),
    };
  }

  // Save the bot's reply
  const { error: botInsertErr } = await supabase.from('public_messages').insert({
    sender_name: 'Unit-7',
    content: reply,
    is_bot: true,
    visitor_id: clientIp,
  });
  if (botInsertErr) {
    console.error('[public-chat] insert bot reply failed:', botInsertErr.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: JSON.stringify({ reply }),
  };
};
