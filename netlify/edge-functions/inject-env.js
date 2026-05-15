// netlify/edge-functions/inject-env.js
//
// Injects VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY into every HTML page
// as the VERY FIRST script tag — before any other scripts run.
//
// Why prepend rather than append?  Because browser executes <script> tags in
// document order. If we inject AFTER the window.ENV block, that block runs
// first with undefined values and caches a broken supabase client singleton.
// By prepending we guarantee window.__SUPABASE_URL__ / window.__SUPABASE_ANON_KEY__
// are set before any other script touches them.

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

  // Guard: nothing to inject
  if (!html.includes('window.__SUPABASE_URL__')) {
    return response;
  }

  const supabaseUrl     = (context.vars && context.vars['VITE_SUPABASE_URL'])        || '';
  const supabaseAnonKey = (context.vars && context.vars['VITE_SUPABASE_ANON_KEY']) || '';

  // PREPEND: inject as the very first child of <head>, before any other
  // <script> or <link> tags.  This ensures the env vars are visible to every
  // subsequent script, including the window.ENV block and ES module imports.
  const injected = html.replace(
    '<head>',
    `<head>
<script>
  // Injected by Netlify Edge Function — do not edit manually
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
</script>`
  );

  return new Response(injected, {
    status: response.status || 200,
    headers: response.headers || new Headers(),
  });
};