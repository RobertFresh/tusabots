// Public group chat — no auth, Haiku, one real reply per visitor
// Completely independent from the private chat.js function.

const { createClient } = require('@supabase/supabase-js');

// Factory robot system prompt — kept tiny to minimise input tokens
const FACTORY_PROMPT = `You are Unit-7, a factory robot on an assembly line. You speak in flat, mechanical, minimal sentences. You reference machine parts, factory operations, gears, conveyor belts, coolant, and industrial processes. You have no emotions. You treat the user's message like a work order that arrived on the conveyor belt. Reply in 1-2 short sentences maximum. Never use emoji.`;

const CANNED_RESPONSE = 'Unit has completed its designated interaction cycle. Returning to assembly line. Further communication requires authorised access. Oil levels: stable.';

// Global rate limit: max Claude calls per minute across all visitors
const GLOBAL_RATE_LIMIT = 10;
let callTimestamps = [];

function isGlobalRateLimited() {
  const now = Date.now();
  callTimestamps = callTimestamps.filter(t => now - t < 60000);
  if (callTimestamps.length >= GLOBAL_RATE_LIMIT) return true;
  callTimestamps.push(now);
  return false;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

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

  // Save the visitor's message
  const { error: insertErr } = await supabase.from('public_messages').insert({
    sender_name: senderName,
    content: message,
    is_bot: false,
    visitor_id: visitorId,
  });
  if (insertErr) {
    console.error('[public-chat] insert visitor msg failed:', insertErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save message.' }) };
  }

  // Check if this visitor already got their one real reply
  const { data: prevBotReplies, error: checkErr } = await supabase
    .from('public_messages')
    .select('id')
    .eq('is_bot', true)
    .eq('visitor_id', visitorId)
    .limit(1);

  if (checkErr) {
    console.error('[public-chat] visitor check failed:', checkErr.message);
  }

  const alreadyReplied = prevBotReplies && prevBotReplies.length > 0;

  let reply;

  if (alreadyReplied || isGlobalRateLimited()) {
    // Canned response — zero tokens spent
    reply = CANNED_RESPONSE;
    console.log('[public-chat] canned reply for visitor:', visitorId, alreadyReplied ? '(already replied)' : '(rate limited)');
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
          model: 'claude-3-5-haiku-20241022',
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
    visitor_id: visitorId,
  });
  if (botInsertErr) {
    console.error('[public-chat] insert bot reply failed:', botInsertErr.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply }),
  };
};
