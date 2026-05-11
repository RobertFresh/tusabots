// TusaBot chat function — Supabase memory, Anthropic Claude
const { createClient } = require('@supabase/supabase-js');

const SYSTEM_PROMPT = "You are TusaBot, James's personal AI assistant. Be helpful, concise, and friendly.";

// Supabase memory layer (optional — bot works without it)
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

async function getMemory(userId = 'global', limit = 20) {
  if (!supabase) return [];
  const { data } = await supabase
    .from('messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

async function saveMessage(userId, role, content) {
  if (!supabase) return;
  await supabase.from('messages').insert({ user_id: userId, role, content });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Claude API key not configured. Set ANTHROPIC_API_KEY in Netlify environment variables.' })
    };
  }

  const { message, userId = 'global' } = JSON.parse(event.body);
  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'No message' }) };

  const history = await getMemory(userId);
  history.push({ role: 'user', content: message });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-7',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history
    })
  });

  if (!res.ok) {
    const err = await res.text();
    return { statusCode: 500, body: JSON.stringify({ error: 'API error', detail: err }) };
  }

  const data = await res.json();
  const reply = data.content[0].text;

  // Fire-and-forget memory saves
  saveMessage(userId, 'user', message).catch(() => {});
  saveMessage(userId, 'assistant', reply).catch(() => {});

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply })
  };
};
