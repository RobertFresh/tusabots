// TriggBot chat function — proxies to the REAL TriggBot via its API
// Unlike ollama-chat.js (raw Ollama), this talks to the actual running bot
// which has live Twitch/YouTube stream context.
const { validateAuth } = require('./auth-validate.js');

const TRIGGBOT_TUNNEL = process.env.TRIGGBOT_TUNNEL_URL || 'https://twigg.tusabots.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // CORS
  const origin = event.headers['origin'] || '';
  const ALLOWED_ORIGINS = ['https://tusabots.netlify.app', 'https://tusabots.com', 'https://www.tusabots.com'];
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden.' }) };
  }

  // Auth — dashboard only
  const authResult = await validateAuth(event);
  if (authResult.user === null) {
    return { statusCode: authResult.statusCode, body: authResult.body };
  }

  // Env check
  if (!process.env.TUNNEL_SECRET) {
    console.error('[triggbot-chat] Missing TUNNEL_SECRET');
    return { statusCode: 500, body: JSON.stringify({ error: 'Tunnel not configured.' }) };
  }

  // Parse request
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const message = body.message;
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20);

  if (!message || message.length > 2000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Message required (max 2000 chars).' }) };
  }

  // Determine action: relay or chat
  // If message starts with "relay:" or "say:", treat as a relay command
  const relayMatch = message.match(/^(?:relay|say|tell\s+(?:dan|chat|them|everyone)):\s*(.+)/i);
  const isRelay = !!relayMatch;
  const endpoint = isRelay ? '/relay' : '/chat';
  const payload = isRelay
    ? { message: relayMatch[1].trim(), rephrase: true }
    : { message, history };

  const tunnelUrl = TRIGGBOT_TUNNEL.replace(/\/$/, '');

  try {
    const res = await fetch(`${tunnelUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tunnel-Secret': process.env.TUNNEL_SECRET,
        'User-Agent': 'Mozilla/5.0 TusaBots-Netlify/1.0',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[triggbot-chat] API error:', res.status, err);
      if (res.status === 403) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Tunnel auth failed.' }) };
      }
      if (res.status === 503) {
        return { statusCode: 200, body: JSON.stringify({ reply: 'TriggBot is not connected to Twitch right now.' }) };
      }
      return { statusCode: 500, body: JSON.stringify({ error: 'TriggBot unavailable.' }) };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply: data.reply || 'No response.',
        sent: data.sent || false,
        message_sent: data.message_sent || null,
      }),
    };
  } catch (e) {
    console.error('[triggbot-chat] Connection error:', e.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Cannot reach TriggBot. Pi may be down.' }),
    };
  }
};
