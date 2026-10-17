// netlify/functions/upload.js
// TusaBot file upload handler — validates session, writes to Supabase Storage
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
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

  // ── Security: sanitize filename (prevent path traversal) ──────────────
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeName || safeName.startsWith('.')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid file name.' }) };
  }

  // ── Security: file size limit (4MB base64 ≈ 3MB decoded) ─────────────
  const MAX_BASE64_SIZE = 4 * 1024 * 1024;
  if (base64Data.length > MAX_BASE64_SIZE) {
    return { statusCode: 413, body: JSON.stringify({ error: 'File too large. Max 3MB.' }) };
  }

  // ── Security: file type allowlist ─────────────────────────────────────
  const ALLOWED_TYPES = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf', 'text/plain', 'text/csv',
  ];
  const safeType = (fileType || '').toLowerCase();
  if (!ALLOWED_TYPES.includes(safeType)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'File type not allowed.' }) };
  }

  if (!supabaseAdmin) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Storage not configured.' }) };
  }

  const buffer = Buffer.from(base64Data, 'base64');
  const storagePath = `${userId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('tusabot-files')
    .upload(storagePath, buffer, { contentType: safeType });

  if (uploadError) {
    console.error('[upload] Storage error:', uploadError.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Upload failed.' }) };
  }

  const { data: urlData } = supabaseAdmin.storage.from('tusabot-files').getPublicUrl(storagePath);

  // Record file metadata (fire-and-forget — log errors, don't block response)
  supabaseAdmin.from('files').insert({
    user_id: userId,
    file_name: safeName,
    file_type: safeType,
    storage_path: urlData.publicUrl
  }).catch(err => console.error('[upload/saveMeta FAILED]', err));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: urlData.publicUrl })
  };
};