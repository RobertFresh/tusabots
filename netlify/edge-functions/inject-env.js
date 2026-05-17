// netlify/edge-functions/inject-env.js
//
// Injects Supabase credentials into HTML responses at runtime.

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
  } catch (_) {
    return response;
  }

  // Use Deno.env.get() — context.vars is not populated in this Netlify edge runtime.
  const supabaseUrl     = Deno.env.get('VITE_SUPABASE_URL')     || '';
  const supabaseAnonKey = Deno.env.get('VITE_SUPABASE_ANON_KEY') || '';

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
