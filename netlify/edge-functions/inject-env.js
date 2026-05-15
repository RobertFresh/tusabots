// netlify/edge-functions/inject-env.js
//
// Netlify Edge Function — injects VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// into every HTML page by replacing placeholder window.__SUPABASE_*__ values.
//
// Why an edge function?  Because this is a no-build-step static site. The HTML
// files are pre-built and served as-is, so there is no webpack/vite process
// where NODE_ENV vars could be injected at build time. The edge function sits
// between Netlify's CDN and the browser, intercepts every HTML response, and
// patches in the real values from Netlify's environment variables.

export default async (request, context) => {
  let response;

  try {
    // context.next() passes the request to the next handler in the chain
    // (i.e. the static file server) and returns the HTML response
    response = await context.next();
  } catch (err) {
    // If the chain itself breaks, log it and pass through unchanged
    console.error('[inject-env] context.next() threw:', err.message);
    return new Response('Internal server error', { status: 500 });
  }

  // Only transform HTML — leave images, CSS, JS, fonts untouched
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

  // Guard: skip pages that don't have our placeholder (already transformed or not our page)
  if (!html.includes('window.__SUPABASE_URL__')) {
    return response;
  }

  // Read env vars from the Netlify edge context
  // These must be set in Site Settings → Environment Variables
  const supabaseUrl    = (context.vars && context.vars['VITE_SUPABASE_URL'])    || '';
  const supabaseAnonKey = (context.vars && context.vars['VITE_SUPABASE_ANON_KEY']) || '';

  // Inject the real values just before </head>
  // JSON.stringify ensures any special characters in the keys are safely escaped
  const injected = html.replace(
    '</head>',
    `<script>
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
</script></head>`
  );

  return new Response(injected, {
    status: response.status || 200,
    headers: response.headers || new Headers(),
  });
};