// netlify/functions/upload.js
// TusaBot file upload handler — validates session, writes to Supabase Storage
const { createClient } = require('@supabase/supabase-js');
const { validateAuth, getUserId } = require('./auth-validate.js');

// ─── Storage client (service role for file operations) ─────────────────────

const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ─── Main handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const authResult = await validateAuth(event);
  if (authResult.user === null) {
    return { statusCode: authResult.statusCode, body: authResult.body };
  }
  const userId = getUserId(authResult.user) || authResult.user.user?.id || authResult.user.user?.sub;

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

  const buffer = Buffer.from(base64Data, 'base64');
  const path = `${userId}/${Date.now()}-${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('tusabot-files')
    .upload(path, buffer, { contentType: fileType || 'application/octet-stream' });

  if (uploadError) {
    return { statusCode: 500, body: JSON.stringify({ error: uploadError.message }) };
  }

  const { data: urlData } = supabaseAdmin.storage.from('tusabot-files').getPublicUrl(path);

  // Record file metadata (fire-and-forget — log errors, don't block response)
  supabaseAdmin.from('files').insert({
    user_id: userId,
    file_name: fileName,
    file_type: fileType,
    storage_path: urlData.publicUrl
  }).catch(err => console.error('[upload/saveMeta FAILED]', err));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: urlData.publicUrl })
  };
};