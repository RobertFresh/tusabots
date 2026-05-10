// netlify/functions/upload.js
// TusaBot file upload handler — stores files in Supabase Storage
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { fileName, fileType, base64Data, userId = 'global' } = JSON.parse(event.body);
  if (!fileName || !base64Data) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
  }

  const buffer = Buffer.from(base64Data, 'base64');
  const path = `${userId}/${Date.now()}-${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('tusabot-files')
    .upload(path, buffer, { contentType: fileType || 'application/octet-stream' });

  if (uploadError) {
    return { statusCode: 500, body: JSON.stringify({ error: uploadError.message }) };
  }

  const { data: urlData } = supabase.storage.from('tusabot-files').getPublicUrl(path);

  await supabase.from('files').insert({
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
