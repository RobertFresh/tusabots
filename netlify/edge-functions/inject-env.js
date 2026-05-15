// netlify/edge-functions/inject-env.js
//
// Injects Supabase credentials into HTML responses only.
//
// No import map — @supabase/supabase-js has been removed from the frontend.
// Auth now uses vendor/supabase-rest.js (pure fetch/REST, no CDN).
//
// Only HTML responses are touched; all other files pass through unchanged.

export default async (request, context) => {
  let response;

  try {
    response = await context.next();
  } catch (err) {
    console.error('[inject-env] context.next() threw:', err.message);
    return new Response('Internal server error', { status: 500 });
  }

  // Only process HTML responses — let JS/CSS/media pass through unchanged.
  // Guard against missing headers or weird content-type values.
  let contentType = '';
  try {
    contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
  } catch (_) {}

  if (!contentType.includes('text/html')) {
    return response;
  }

  let html;
  try {
    html = await response.text();
  } catch (_) {
    // Could not read body — pass the response through as-is.
    return response;
  }

  // Skip pages that don't use the env var injection pattern.
  if (!html.includes('window.__SUPABASE_URL__')) {
    return response;
  }

  const supabaseUrl     = (context.vars?.['VITE_SUPABASE_URL'])        || '';
  const supabaseAnonKey = (context.vars?.['VITE_SUPABASE_ANON_KEY']) || '';

  // Build env var injection script.
  // Using '</scr'+'ipt>' (split tag) prevents the HTML parser from
  // misinterpreting this string as closing the outer <script> tag.
  const envVarsScript = `<script>
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
</scr${'ipt>'}`;

  const injected = html.replace('<head>', `<head>\n${envVarsScript}`);

  return new Response(injected, {
    status: response.status || 200,
    headers: response.headers || new Headers(),
  });
};