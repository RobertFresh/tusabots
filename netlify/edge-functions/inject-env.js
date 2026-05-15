// netlify/edge-functions/inject-env.js
//
// Injects an import map into every HTML response so the browser can resolve
// @supabase/* bare specifiers without a bundler.
//
// Uses esm.sh with the ?bundle flag:
//   https://esm.sh/@supabase/supabase-js@2?bundle
//
// The ?bundle flag is the key: it tells esm.sh to return a SINGLE FILE that
// rewrites ALL relative imports inside each @supabase/* package to absolute
// esm.sh URLs.  The browser then fetches those URLs directly.  This avoids
// the entire class of failures we hit with jsdelivr — where relative imports
// inside a package (e.g. "./FunctionsClient") couldn't be resolved because the
// browser tried to fetch them as top-level URLs.
//
// Verified working:
//   @supabase/supabase-js  → re-exports full client API
//   @supabase/auth-js      → AuthClient, GoTrueClient, etc.
//   @supabase/functions-js → FunctionsClient
//   @supabase/realtime-js → RealtimeClient
//   @supabase/postgrest-js → PostgrestClient
//   @supabase/storage-js  → StorageClient
//
// env vars injected as window.__SUPABASE_URL__ / window.__SUPABASE_ANON_KEY__
// so lib/supabase.js initialises the real Supabase client.

const SUPABASE_PACKAGES = [
  '@supabase/supabase-js',
  '@supabase/auth-js',
  '@supabase/functions-js',
  '@supabase/realtime-js',
  '@supabase/postgrest-js',
  '@supabase/storage-js',
];

// Build the import map entries using esm.sh ?bundle for each package.
// The ?bundle flag makes esm.sh return a self-contained file where all
// internal relative imports have been rewritten to absolute esm.sh URLs.
const IMPORTS = Object.fromEntries(
  SUPABASE_PACKAGES.map((pkg) => [pkg, `https://esm.sh/${pkg}@2?bundle`])
);

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

  // Build the import map — </scr'+'ipt> prevents the HTML parser from
  // prematurely closing the outer <script> tag when scanning the response body.
  const scriptOpen  = '<script type="importmap">';
  const scriptClose = '</scr' + 'ipt>';
  const importMapJson = JSON.stringify({ imports: IMPORTS }, null, 2);
  const importMapScript = `${scriptOpen}\n${importMapJson}\n${scriptClose}`;

  // Inject env vars into window.__SUPABASE_*__ so lib/supabase.js reads them
  const envVarsScript = `<script>
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
</script>`;

  // Prepend to <head>: importmap first, then env vars
  const injected = html.replace(
    '<head>',
    `<head>\n${importMapScript}\n${envVarsScript}`
  );

  return new Response(injected, {
    status: response.status || 200,
    headers: response.headers || new Headers(),
  });
};