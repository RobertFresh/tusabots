// netlify/edge-functions/inject-env.js
//
// Runs on every HTTP response before it's delivered to the browser.
// Intercepts HTML pages and injects a <script> tag that populates
// window.__SUPABASE_URL__ and window.__SUPABASE_ANON_KEY__ from the
// Netlify environment variables — so lib/supabase.js reads real values
// instead of the undefined placeholders that were in the static HTML.
//
// This is the cleanest way to pass runtime env vars to a no-build-step
// static site on Netlify.

export default async (request, context) => {
  const response = await context.next();

  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  // Only transform HTML pages — leave CSS, JS, images, fonts, etc. untouched
  if (!contentType.includes('text/html')) {
    return response;
  }

  const html = await response.text();

  // Guard: if the placeholder replacement already happened somehow, skip
  if (!html.includes('window.__SUPABASE_URL__')) {
    return response;
  }

  const url    = context.vars['VITE_SUPABASE_URL']    || '';
  const anon   = context.vars['VITE_SUPABASE_ANON_KEY'] || '';

  const injected = html.replace(
    '</head>',
    `<script>
  window.__SUPABASE_URL__     = ${JSON.stringify(url)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(anon)};
</script></head>`
  );

  return new Response(injected, response);
};