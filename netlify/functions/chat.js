const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const SYSTEM_PROMPT = "You are TusaBot, James's personal AI assistant. Be helpful, concise, and friendly.";

const anthropic = new Anthropic();

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

  const { message, userId = 'global' } = JSON.parse(event.body);
  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'No message' }) };

  const history = await getMemory(userId);
  history.push({ role: 'user', content: message });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history
    });

    const reply = response.content[0].text;

    saveMessage(userId, 'user', message).catch(() => {});
    saveMessage(userId, 'assistant', reply).catch(() => {});

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'API error', detail: err.message })
    };
  }
};
