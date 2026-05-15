// netlify/edge-functions/inject-env.js
//
// Injects Supabase credentials into every HTML response.
//
// No longer injects an import map — @supabase/supabase-js has been removed
// from the frontend entirely.  Auth now uses vendor/supabase-rest.js which
// makes direct fetch() calls to the Supabase REST API and needs no CDN.
//
// This function ONLY injects the window.__SUPABASE_URL__ /
// window.__SUPABASE_ANON_KEY__ values from the Netlify env vars so that
// lib/supabase.js can read them at runtime.

export default async (request, context) => {
  let response;

  try {
    response = await context.next();
  } catch (err) {
    console.error('[inject-env] context.next() threw:', err.message);
    return new Response('Internal server error', { status: 500 });
  }

  const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return response;
  }

  let html;
  try {
    html = await response.text();
  } catch (err) {
    console.error('[inject-env] response.text() threw:', err.message);
    return response;
  }

  if (!html.includes('window.__SUPABASE_URL__')) {
    return response;
  }

  const supabaseUrl     = (context.vars && context.vars['VITE_SUPABASE_URL'])        || '';
  const supabaseAnonKey = (context.vars && context.vars['VITE_SUPABASE_ANON_KEY']) || '';

  // Inject env vars into window.__SUPABASE_*__
  // </scr'+'ipt> prevents the HTML parser from prematurely closing
  // the outer <script> tag when scanning the response body.
  const scriptOpen  = '<script>';
  const scriptClose = '</scr' + 'ipt>';
  const envVarsScript = `${scriptOpen}
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
${scriptClose}`;

  const injected = html.replace(
    '<head>',
    `<head>\n${envVarsScript}`
  );

  return new Response(injected, {
    status: response.status || 200,
    headers: response.headers || new Headers(),
  });
};