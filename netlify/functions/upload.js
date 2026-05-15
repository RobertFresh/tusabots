// netlify/functions/upload.js
// TusaBot file upload handler — validates session, writes to Supabase Storage

const { createClient } = require('@supabase/supabase-js');

// ─── Auth: validate JWT, derive userId server-side ──────────────────────────

async function validateAuth(event) {
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      user: null,
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized. No token provided.' })
    };
  }

  const token = authHeader.slice(7);

  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    return {
      user: null,
      statusCode: 503,
      body: JSON.stringify({ error: 'Server misconfiguration. Supabase env vars not set.' })
    };
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
  );

  const { data: user, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return {
      user: null,
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized. Invalid or expired token.' })
    };
  }

  return { user, statusCode: null, body: null };
}

// ─── Storage client (service role for file operations) ─────────────────────

const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ─── Main handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Step 1: Authenticate
  const authResult = await validateAuth(event);
  if (authResult.user === null) {
    return { statusCode: authResult.statusCode, body: authResult.body };
  }
  const userId = authResult.user.id; // Server-derived from validated JWT

  // Step 2: Parse request — userId from body is ignored
  let fileName, fileType, base64Data;
  try {
    const body = JSON.parse(event.body);
    fileName = body.fileName;
    fileType = body.fileType;
    base64Data = body.base64Data;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };
  }

  if (!fileName || !base64Data) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing fileName or base64Data.' }) };
  }

  if (!supabaseAdmin) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Storage not configured.' }) };
  }

  // Step 3: Upload to Supabase Storage scoped to this user
  const buffer = Buffer.from(base64Data, 'base64');
  const path = `${userId}/${Date.now()}-${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('tusabot-files')
    .upload(path, buffer, { contentType: fileType || 'application/octet-stream' });

  if (uploadError) {
    return { statusCode: 500, body: JSON.stringify({ error: uploadError.message }) };
  }

  const { data: urlData } = supabaseAdmin.storage.from('tusabot-files').getPublicUrl(path);

  // Step 4: Record file metadata
  await supabaseAdmin.from('files').insert({
    user_id: userId,
    file_name: fileName,
    file_type: fileType,
    storage_path: urlData.publicUrl
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: urlData.publicUrl })
  };
};