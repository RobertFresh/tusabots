// TusaBot chat function — Supabase memory, Anthropic Claude
const { createClient } = require('@supabase/supabase-js');

const SYSTEM_PROMPT = "You are TusaBot, James's personal AI assistant. Be helpful, concise, and friendly.";

// Supabase memory layer
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

console.log('SUPABASE_URL set:', !!process.env.SUPABASE_URL);
console.log('SUPABASE_SERVICE_ROLE_KEY set:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('supabase client initialized:', !!supabase);

async function getMemory(userId = 'global', limit = 20) {
  if (!supabase) { console.log('getMemory: no supabase client'); return []; }
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) console.error('getMemory error:', error.message);
    console.log('getMemory returned:', data?.length, 'rows');
    return (data || []).reverse();
  } catch(e) { console.error('getMemory exception:', e.message); return []; }
}

async function saveMessage(userId, role, content) {
  if (!supabase) { console.log('saveMessage: no supabase client'); return; }
  try {
    const { data, error } = await supabase.from('messages').insert({ user_id: userId, role, content });
    if (error) console.error('saveMessage error:', error.message, error.details);
    else console.log('saveMessage success:', role, '-', content.substring(0, 40));
  } catch(e) { console.error('saveMessage exception:', e.message); }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  console.log('ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Claude API key not configured. Set ANTHROPIC_API_KEY in Netlify environment variables.' })
    };
  }

  const { message, userId = 'global' } = JSON.parse(event.body);
  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'No message' }) };

  console.log('Incoming - userId:', userId, 'message:', message.substring(0, 50));

  const history = await getMemory(userId);
  console.log('Using', history.length, 'history messages');

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
    console.error('Anthropic API error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'API error', detail: err }) };
  }

  const data = await res.json();
  const reply = data.content[0].text;
  console.log('Claude reply received, length:', reply.length);

  saveMessage(userId, 'user', message);
  saveMessage(userId, 'assistant', reply);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply })
  };
};