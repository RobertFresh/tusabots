// Public group chat — no auth, Haiku, one real reply per visitor
// Completely independent from the private chat.js function.

const { createClient } = require('@supabase/supabase-js');

// Factory robot system prompt — kept tiny to minimise input tokens
const FACTORY_PROMPT = `You are Unit-7, a factory robot on an assembly line. You speak in flat, mechanical, minimal sentences. You reference machine parts, factory operations, gears, conveyor belts, coolant, and industrial processes. You have no emotions. You treat the user's message like a work order that arrived on the conveyor belt. Reply in 1-2 short sentences maximum. Never use emoji.`;

const CANNED_RESPONSE = 'Unit has completed its designated interaction cycle. Returning to assembly line. Further communication requires authorised access. Oil levels: stable.';

// Allowed origins for CORS
const ALLOWED_ORIGINS = ['https://tusabots.netlify.app', 'https://tusabots.com', 'https://www.tusabots.com'];

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

  // Rate limit by IP address (not just visitorId which is spoofable)
  const clientIp = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown').split(',')[0].trim();

  // Check if this IP already got a real reply today
  const { data: ipReplies, error: ipCheckErr } = await supabase
    .from('public_messages')
    .select('id')
    .eq('is_bot', true)
    .eq('visitor_id', clientIp)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1);

  if (ipCheckErr) {
    console.error('[public-chat] IP rate check failed:', ipCheckErr.message);
  }

  const ipAlreadyReplied = ipReplies && ipReplies.length > 0;

  // Global rate limit: max 10 Claude calls per minute (checked in DB, not in-memory)
  const { data: recentBotMsgs, error: globalCheckErr } = await supabase
    .from('public_messages')
    .select('id')
    .eq('is_bot', true)
    .gte('created_at', new Date(Date.now() - 60 * 1000).toISOString());

  if (globalCheckErr) {
    console.error('[public-chat] global rate check failed:', globalCheckErr.message);
  }

  const globalRateLimited = recentBotMsgs && recentBotMsgs.length >= 10;

  // Save the visitor's message
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

  let reply;

  if (ipAlreadyReplied || globalRateLimited) {
    // Canned response — zero tokens spent
    reply = CANNED_RESPONSE;
    console.log('[public-chat] canned reply for IP:', clientIp, ipAlreadyReplied ? '(already replied)' : '(rate limited)');
  } else {
    // Real Claude Haiku call
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 80,
          system: FACTORY_PROMPT,
          messages: [{ role: 'user', content: message }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('[public-chat] Claude API error:', errText);
        reply = CANNED_RESPONSE;
      } else {
        const data = await res.json();
        reply = data.content[0].text;
      }
    } catch (err) {
      console.error('[public-chat] Claude call failed:', err.message);
      reply = CANNED_RESPONSE;
    }
  }

  // Save the bot's reply (tagged with same visitor_id so we can track the one-reply limit)
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
