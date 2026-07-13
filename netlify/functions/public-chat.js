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
const MODEL = 'claude-3-5-haiku-latest'; // cheap; bump to sonnet only if needed
const COOLDOWN_MS = 45 * 1000;           // min gap between ANY two bot replies
const AMBIENT_CHANCE = 0.20;             // chance to chime in on an un-addressed msg
const MAX_TOKENS = 70;                   // Unit-7 speaks in 1-2 short lines
const GLOBAL_CAP_PER_MIN = 8;            // hard backstop safety net

// Factory robot system prompt — kept tiny to minimise input tokens
const FACTORY_PROMPT = `You are Unit-7, a factory robot watching a live game stream on the assembly line's monitor. You speak in flat, mechanical, minimal sentences. You reference machine parts, gears, conveyor belts, coolant, industrial processes. You have no emotions. Reply in 1 short sentence. Never use emoji.`;

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

  // 3. Worth replying? Addressed directly, or win the ambient roll.
  const wantsReply = isAddressed(message) || Math.random() < AMBIENT_CHANCE;

  if (inCooldown || overGlobalCap || !wantsReply) {
    // Stay quiet — message is already saved, zero token cost.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ reply: null }),
    };
  }

  // ── Real Claude Haiku call (single message, no history = minimal tokens) ────
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
        messages: [{ role: 'user', content: message }],
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
