// Commander chat function — proxies slash commands to Pi via Cloudflare Tunnel
// Used by The Commander on the dashboard
const { validateAuth } = require('./auth-validate.js');

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
  if (!process.env.TUNNEL_SECRET) {
    console.error('[commander-chat] Missing TUNNEL_SECRET');
    return { statusCode: 500, body: JSON.stringify({ error: 'Tunnel not configured.' }) };
  }

  // Parse request
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  const message = (body.message || '').trim();
  if (!message || message.length > 200) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Command required (max 200 chars).' }) };
  }

  // Normalize: ensure it starts with /
  const command = message.startsWith('/') ? message : '/' + message;

  // Call Commander API via tunnel
  const tunnelUrl = 'https://cmd.tusabots.com';
  try {
    const res = await fetch(tunnelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tunnel-Secret': process.env.TUNNEL_SECRET,
        'User-Agent': 'Mozilla/5.0 TusaBots-Netlify/1.0',
      },
      body: JSON.stringify({ command }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[commander-chat] API error:', res.status, err);
      if (res.status === 403) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Tunnel auth failed.' }) };
      }
      // Try to parse error for user-friendly message
      try {
        const errData = JSON.parse(err);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reply: errData.error || 'Unknown command.' }),
        };
      } catch {
        return { statusCode: 500, body: JSON.stringify({ error: 'Command failed.' }) };
      }
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: data.reply || 'No response.' }),
    };
  } catch (e) {
    console.error('[commander-chat] Tunnel connection error:', e.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Cannot reach Pi. Tunnel may be down.' }),
    };
  }
};
