// TusaBot chat function — Supabase memory, Anthropic Claude
const { createClient } = require('@supabase/supabase-js');

const SYSTEM_PROMPT = "You are TusaBot, James's personal AI assistant. Be helpful, concise, and friendly.";

// Supabase memory layer
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

async function getMemory(userId = 'global', limit = 20) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).reverse();
  } catch(e) {
    console.error('getMemory failed:', e.message);
    return [];
  }
}

async function saveMessage(userId, role, content) {
  if (!supabase) {
    console.error('saveMessage skipped: no supabase client');
    return { success: false, reason: 'no supabase client' };
  }
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert({ user_id: userId, role, content })
      .select();
    if (error) {
      console.error('saveMessage insert error:', JSON.stringify(error));
      return { success: false, reason: error.message };
    }
    console.log('saveMessage success:', data?.[0]?.id);
    return { success: true, id: data?.[0]?.id };
  } catch(e) {
    console.error('saveMessage exception:', e.message);
    return { success: false, reason: e.message };
  }
}

// Debug endpoint — GET /.netlify/functions/chat?debug=1
exports.handler = async (event) => {
  // Debug endpoint
  if (event.httpMethod === 'GET' && event.queryStringParameters?.debug === '1') {
    const testInsert = supabase ? await supabase
      .from('messages')
      .insert({ user_id: 'debug', role: 'user', content: 'debug_test_' + Date.now() })
      .select('id')
      .single()
      .catch(e => ({ error: e.message })) : { error: 'no supabase' };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supabaseConfigured: !!supabase,
        supabaseUrl: process.env.SUPABASE_URL ? 'SET' : 'MISSING',
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING',
        anthropicKey: process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING',
        testInsert,
        timestamp: new Date().toISOString()
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Claude API key not configured.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { message, userId = 'global' } = body;
  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'No message' }) };

  console.log('--- Chat Request ---');
  console.log('userId:', userId, 'message length:', message.length);

  // Get memory (retrieves history from Supabase)
  const history = await getMemory(userId);
  console.log('Retrieved', history.length, 'history messages');

  // Build messages array for Claude
  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message }
  ];

  // Call Claude
  let reply;
  try {
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
        messages
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Claude API error:', err);
      return { statusCode: 500, body: JSON.stringify({ error: 'API error', detail: err }) };
    }

    const data = await res.json();
    reply = data.content[0].text;
    console.log('Claude reply length:', reply.length);
  } catch(e) {
    console.error('Claude call failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Claude call failed: ' + e.message }) };
  }

  // Save to Supabase — wait for both to complete so we can return errors
  const userSave = await saveMessage(userId, 'user', message);
  const asstSave = await saveMessage(userId, 'assistant', reply);
  console.log('User save:', userSave, 'Assistant save:', asstSave);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reply,
      _debug: { userSave, asstSave, historyCount: history.length }
    })
  };
};