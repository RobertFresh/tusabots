// netlify/edge-functions/inject-env.js
//
// Two jobs:
//  1. Inject an import map so the browser can resolve bare module specifiers
//     like "@supabase/supabase-js" without a bundler or node_modules.
//  2. Inject the real Supabase credentials as window.__SUPABASE_*__
//     so lib/supabase.js initialises against the real project.
//
// Both are prepended to <head> as the very first children — before any
// other <script> or <link> tags — to guarantee correct load order.

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

  const supabaseUrl     = (context.vars && context.vars['VITE_SUPABASE_URL'])        || '';
  const supabaseAnonKey = (context.vars && context.vars['VITE_SUPABASE_ANON_KEY']) || '';

  // Import map so bare "@supabase/supabase-js" specifier resolves in the browser.
  // Using jsdelivr CDN as the source — fast, globally cached, permanent URLs.
  // If you ever swap in a local node_modules bundler, remove this block.
  const importMapScript = `<script type="importmap">
{
  "imports": {
    "@supabase/supabase-js": "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/module/index.js"
  }
}
<\/script>`;

  // Inject the Supabase env vars as the second child of <head>.
  // These feed window.ENV in lib/supabase.js.
  const envVarsScript = `<script>
  // Injected by Netlify Edge Function — do not edit manually
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
</script>`;

  // Both prepended as the first children of <head>, in correct load order:
  //   1. importmap  (before any module scripts that import supabase-js)
  //   2. env vars   (before any script that reads window.__SUPABASE_*__)
  const injected = html.replace(
    '<head>',
    `<head>
${importMapScript}
${envVarsScript}`
  );

  return new Response(injected, {
    status: response.status || 200,
    headers: response.headers || new Headers(),
  });
};