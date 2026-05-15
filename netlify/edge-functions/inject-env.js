// netlify/edge-functions/inject-env.js
//
// Dynamic import map resolution via jsdelivr's package metadata API.
//
// Rather than hardcoding every bare specifier → CDN URL mapping, this fetches
// the package metadata from jsdelivr at edge-runtime startup and builds a
// complete import map automatically.  Static fallbacks ensure the map is
// always populated even if the metadata fetch fails.
//
// NOTE: We break the closing </script> tag as </scr'+'ipt> in the injected
// HTML to prevent the HTML parser from prematurely closing the outer
// <script> tag when it scans the response body.

const jsdelivrBase = 'https://cdn.jsdelivr.net/npm';

// Packages to resolve; @supabase/supabase-js is the entry-point package.
const SUPABASE_PACKAGES = [
  '@supabase/supabase-js',
  '@supabase/auth-js',
  '@supabase/postgrest-js',
  '@supabase/realtime-js',
  '@supabase/storage-js',
  '@supabase/functions-js',
  '@supabase/gotrue-js',
];

// Static fallbacks — used when the metadata fetch fails or returns nothing.
const FALLBACK_IMPORTS = {
  '@supabase/supabase-js':  `${jsdelivrBase}/@supabase/supabase-js@2/dist/module/index.js`,
  '@supabase/auth-js':      `${jsdelivrBase}/@supabase/auth-js@2/dist/module/index.js`,
  '@supabase/postgrest-js': `${jsdelivrBase}/@supabase/postgrest-js@2/dist/module/index.js`,
  '@supabase/realtime-js':  `${jsdelivrBase}/@supabase/realtime-js@2/dist/module/index.js`,
  '@supabase/storage-js':   `${jsdelivrBase}/@supabase/storage-js@2/dist/module/index.js`,
  '@supabase/functions-js': `${jsdelivrBase}/@supabase/functions-js@2/dist/module/index.js`,
  '@supabase/gotrue-js':   `${jsdelivrBase}/@supabase/gotrue-js@2/dist/module/index.js`,
};

async function buildImportMap() {
  const results = await Promise.all(
    SUPABASE_PACKAGES.map(async (pkg) => {
      try {
        const url = `${jsdelivrBase}/${pkg}@2/package.json`;
        const res = await fetch(url);
        if (!res.ok) return [pkg, null];
        const meta = await res.json();
        // main / module / exports['.'] — pick whichever is available
        const file =
          meta.exports?.['.']?.import ||
          meta.exports?.['.']?.default ||
          meta.module ||
          meta.main;
        if (!file) return [pkg, null];
        return [pkg, `${jsdelivrBase}/${pkg}@2${file.startsWith('/') ? file : '/' + file}`];
      } catch {
        return [pkg, null];
      }
    })
  );

  const discovered = Object.fromEntries(results.filter(([, v]) => v !== null));
  return { ...FALLBACK_IMPORTS, ...discovered }; // discovered overrides fallbacks
}

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

  const imports = await buildImportMap();

  // Inject the import map as the very first child of <head>.
  //
  // CRITICAL: We break the closing </script> tag so the HTML parser does NOT
  // prematurely close the outer <script> tag when scanning the injected body.
  // Writing </script> directly inside a <script> tag in HTML source causes the
  // parser to think the tag is closed, breaking the import map entirely.
  const scriptOpen  = '<script type="importmap">';
  const scriptClose = '</scr' + 'ipt>';   // ← split to avoid HTML-parser confusion
  const json       = JSON.stringify({ imports }, null, 2);
  const importMapScript = `${scriptOpen}\n${json}\n${scriptClose}`;

  // Env vars injected second — feeds lib/supabase.js
  const envVarsScript = `<script>
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
</script>`;

  const injected = html.replace(
    '<head>',
    `<head>\n${importMapScript}\n${envVarsScript}`
  );

  return new Response(injected, {
    status: response.status || 200,
    headers: response.headers || new Headers(),
  });
};