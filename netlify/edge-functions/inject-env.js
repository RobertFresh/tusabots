// netlify/edge-functions/inject-env.js
//
// Injects Supabase credentials into HTML responses at runtime.
// The anon key (VITE_SUPABASE_ANON_KEY) is injected as a runtime variable
// from the Netlify environment — it never appears in the committed HTML source.
//
// VITE_SUPABASE_URL is also injected via this path to keep credential
// delivery consistent (no build-time dependency on env vars).

export default async (request, context) => {
  let response;
  try {
    response = await context.next();
  } catch (err) {
    console.error('[inject-env] context.next() threw:', err.message);
    return new Response('Internal server error', { status: 500 });
  }

  // Only process HTML responses — let JS/CSS/media pass through unchanged.
  const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return response;
  }

  let html;
  try {
    html = await response.text();
  } catch (_) {
    return response;
  }

  // -- Diagnostics: log all available env sources --
  console.log('[inject-env] === ENV DIAGNOSTIC ===');
  console.log('[inject-env] context.vars:', JSON.stringify(context.vars));
  console.log('[inject-env] context.env:', JSON.stringify(context.env));
  try {
    console.log('[inject-env] Deno.env.get VITE_SUPABASE_URL:', Deno.env.get('VITE_SUPABASE_URL'));
    console.log('[inject-env] Deno.env.get VITE_SUPABASE_ANON_KEY:', Deno.env.get('VITE_SUPABASE_ANON_KEY'));
  } catch (e) {
    console.log('[inject-env] Deno.env not available:', e.message);
  }
  console.log('[inject-env] ==========================');
  // -- Diagnostics end --

  // Build the injection script.  Using '</scr'+'ipt>' prevents the HTML
  // parser from misidentifying this string as closing an outer <script> tag.
  const supabaseUrl     = (context.vars?.['VITE_SUPABASE_URL'])        || '';
  const supabaseAnonKey = (context.vars?.['VITE_SUPABASE_ANON_KEY']) || '';

  const script =
    `<script>` +
    `window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};` +
    `window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};` +
    `</scr${'ipt>'}`;

  const injected = html.replace('<head>', `<head>\n${script}`);

  return new Response(injected, {
    status: response.status || 200,
    headers: response.headers || new Headers(),
  });
};
