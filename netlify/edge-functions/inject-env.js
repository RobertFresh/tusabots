// netlify/edge-functions/inject-env.js
//
// Injects an import map into every HTML response so the browser can resolve
// @supabase/* bare specifiers without a bundler.
//
// The import map entries are hardcoded with the correct jsdelivr CDN paths for
// each @supabase-js v2 package.  These are derived from the package.json
// "module" field (ESM entry point) and verified to exist on cdn.jsdelivr.net.
//
// env vars injected as window.__SUPABASE_URL__ / window.__SUPABASE_ANON_KEY__
// so lib/supabase.js initialises the real Supabase client.

const jsdelivrBase = 'https://cdn.jsdelivr.net/npm';

// Maps each bare specifier to the correct ESM file on jsdelivr.
// Sources: each package's "module" field (or "main" where module absent).
const IMPORTS = {
  '@supabase/supabase-js':   `${jsdelivrBase}/@supabase/supabase-js@2/dist/index.mjs`,
  '@supabase/auth-js':       `${jsdelivrBase}/@supabase/auth-js@2/dist/module/index.js`,
  '@supabase/postgrest-js':  `${jsdelivrBase}/@supabase/postgrest-js@2/dist/index.mjs`,
  '@supabase/realtime-js':   `${jsdelivrBase}/@supabase/realtime-js@2/dist/module/index.js`,
  '@supabase/storage-js':    `${jsdelivrBase}/@supabase/storage-js@2/dist/index.mjs`,
  '@supabase/functions-js':  `${jsdelivrBase}/@supabase/functions-js@2/dist/module/index.js`,
  '@supabase/gotrue-js':     `${jsdelivrBase}/@supabase/gotrue-js@2/dist/module/index.js`,
};

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

  // Build the import map JSON — </scr'+'ipt> prevents HTML-parser premature close
  const scriptOpen  = '<script type="importmap">';
  const scriptClose = '</scr' + 'ipt>';
  const importMapJson = JSON.stringify({ imports: IMPORTS }, null, 2);
  const importMapScript = `${scriptOpen}\n${importMapJson}\n${scriptClose}`;

  // Inject env vars into window.__SUPABASE_*__ so lib/supabase.js reads them
  const envVarsScript = `<script>
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
</script>`;

  // Prepend to <head>: importmap first, then env vars, then the rest of the page
  const injected = html.replace(
    '<head>',
    `<head>\n${importMapScript}\n${envVarsScript}`
  );

  return new Response(injected, {
    status: response.status || 200,
    headers: response.headers || new Headers(),
  });
};