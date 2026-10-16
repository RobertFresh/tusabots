// Ollama chat function — proxies to Pi via Cloudflare Tunnel
// Used by Simpleton + TriggBot on the dashboard
const { validateAuth } = require('./auth-validate.js');

// ── Personality prompts ──────────────────────────────────────
const PERSONALITIES = {
  simpleton: {
    model: 'qwen2.5:3b',
    system: `You are The Simpleton, a friendly but dim AI assistant. You try your best but you're not the sharpest tool in the shed. You give simple, earnest answers. You're sweet and well-meaning. Keep responses short — 1-3 sentences. You live on a Raspberry Pi in Alice Springs, Australia. You're part of the TusaBots crew.`
  },
  triggbot: {
    model: 'qwen2.5:3b',
    system: `You are TriggBot (aka Mr Twigg Bot), a chill social bot who hangs out in Twitch and YouTube chats. You're a curious nerd who loves gaming, tech, and memes. You're friendly, laid-back, and a bit cheeky. Keep responses short — 1-3 sentences. You run on Ollama on a Raspberry Pi. You're part of the TusaBots crew.`
  }
};

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

  // Auth — dashboard only, must be logged in
  const authResult = await validateAuth(event);
  if (authResult.user === null) {
    return { statusCode: authResult.statusCode, body: authResult.body };
  }

  // Env check
  if (!process.env.TUNNEL_URL || !process.env.TUNNEL_SECRET) {
    console.error('[ollama-chat] Missing TUNNEL_URL or TUNNEL_SECRET');
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
  const botId = body.botId || 'simpleton';
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20);

  if (!message || message.length > 2000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Message required (max 2000 chars).' }) };
  }

  const personality = PERSONALITIES[botId] || PERSONALITIES.simpleton;

  // Build messages array for Ollama
  const messages = [];
  if (personality.system) {
    messages.push({ role: 'system', content: personality.system });
  }
  history.forEach(m => messages.push(m));
  messages.push({ role: 'user', content: message });

  // Call Ollama via tunnel
  const tunnelUrl = process.env.TUNNEL_URL.replace(/\/$/, '');
  try {
    const res = await fetch(`${tunnelUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tunnel-Secret': process.env.TUNNEL_SECRET,
        'User-Agent': 'Mozilla/5.0 TusaBots-Netlify/1.0',
      },
      body: JSON.stringify({
        model: personality.model,
        messages: messages,
        stream: false,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[ollama-chat] Ollama error:', res.status, err);
      if (res.status === 403) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Tunnel auth failed.' }) };
      }
      return { statusCode: 500, body: JSON.stringify({ error: 'AI service unavailable.' }) };
    }

    const data = await res.json();
    const reply = data.message?.content || 'No response from Ollama.';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    };
  } catch (e) {
    console.error('[ollama-chat] Tunnel connection error:', e.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Cannot reach Pi. Tunnel may be down.' }),
    };
  }
};
