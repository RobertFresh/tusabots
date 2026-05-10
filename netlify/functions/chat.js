// netlify/functions/chat.js
// TusaBot chat function with Supabase memory layer
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = "You are TusaBot, James's personal AI assistant. Be helpful, concise, and friendly.";

async function getMemory(userId = 'global', limit = 20) {
  const { data } = await supabase
    .from('messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

async function saveMessage(userId, role, content) {
  await supabase.from('messages').insert({ user_id: userId, role, content });
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { message, userId: bodyUserId = 'global' } = JSON.parse(event.body);
  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'No message' }) };

  const identityUser = context.clientContext && context.clientContext.user;
  const userId = identityUser ? identityUser.sub : bodyUserId;

  // Load memory + add new user message
  const history = await getMemory(userId);
  history.push({ role: 'user', content: message });

  // Call Claude
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

  // Save both messages to Supabase
  await saveMessage(userId, 'user', message);
  await saveMessage(userId, 'assistant', reply);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply })
  };
};
