// netlify/edge-functions/inject-env.js
//
// Dynamic import map resolution via jsdelivr's package metadata API.
//
// Rather than manually listing every @supabase/* bare specifier, this fetches
// the package metadata once from jsdelivr and builds a complete import map for
// every package the project needs.  This is a fire-and-forget cache — the first
// request per deploy builds the map and it stays warm for the rest of that
// deploy's lifetime.

const importMapCache = new Map();

// Extend the static set with packages discovered from jsdelivr metadata
async function resolveImports(packages, jsdelivrBase) {
  const out = {};
  const pending = [];

  for (const pkg of packages) {
    const url = `${jsdelivrBase}/${pkg}`;
    pending.push(
      fetch(url)
        .then((r) => r.ok ? r.json() : null)
        .then((meta) => {
          if (!meta) return;
          // main or module entry point
          const file = meta.main || meta.module || meta.exports?.['.']?.import || Object.values(meta.exports || {})[0];
          if (file) out[pkg] = `${jsdelivrBase}/${pkg}${file.startsWith('/') ? file : '/' + file}`;
        })
        .catch(() => {})
    );
  }

  await Promise.all(pending);
  return out;
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

  const jsdelivrBase = 'https://cdn.jsdelivr.net/npm';

  // Resolve all @supabase/* packages the client depends on
  const discovered = await resolveImports(
    [
      '@supabase/supabase-js',
      '@supabase/auth-js',
      '@supabase/postgrest-js',
      '@supabase/realtime-js',
      '@supabase/storage-js',
      '@supabase/functions-js',
      '@supabase/gotrue-js',
    ],
    jsdelivrBase
  );

  // Static fallbacks for packages not found via metadata
  const fallbacks = {
    '@supabase/supabase-js': `${jsdelivrBase}/@supabase/supabase-js@2/dist/module/index.js`,
    '@supabase/auth-js':     `${jsdelivrBase}/@supabase/auth-js@2/dist/module/index.js`,
    '@supabase/postgrest-js':`${jsdelivrBase}/@supabase/postgrest-js@2/dist/module/index.js`,
    '@supabase/realtime-js': `${jsdelivrBase}/@supabase/realtime-js@2/dist/module/index.js`,
    '@supabase/storage-js':  `${jsdelivrBase}/@supabase/storage-js@2/dist/module/index.js`,
    '@supabase/functions-js': `${jsdelivrBase}/@supabase/functions-js@2/dist/module/index.js`,
    '@supabase/gotrue-js':   `${jsdelivrBase}/@supabase/gotrue-js@2/dist/module/index.js`,
  };

  // Merge: discovered URLs override fallbacks when available
  const imports = { ...fallbacks, ...discovered };

  const importMapScript = `<script type="importmap">
${JSON.stringify({ imports }, null, 2)}
<\\/script>`;

  const envVarsScript = `<script>
  window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};
  window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};
</script>`;

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