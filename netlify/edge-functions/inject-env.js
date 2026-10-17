// netlify/edge-functions/inject-env.js
//
// Injects Supabase credentials into HTML responses at runtime.
// Also adds a CSP nonce to allow the injected inline script.

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

  // Generate a cryptographic nonce for CSP
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  const script =
    `<script nonce="${nonce}">` +
    `window.__SUPABASE_URL__     = ${JSON.stringify(supabaseUrl)};` +
    `window.__SUPABASE_ANON_KEY__ = ${JSON.stringify(supabaseAnonKey)};` +
    `</scr${'ipt>'}`;

  let injected = html.replace('<head>', `<head>\n${script}`);

  // Inject the nonce into the CSP header so the browser allows the inline script.
  // Replace any existing script-src directive to include the nonce.
  const headers = new Headers(response.headers);
  const existingCsp = headers.get('content-security-policy') || '';
  if (existingCsp) {
    const updatedCsp = existingCsp.replace(
      /script-src\s+([^;]*)/,
      `script-src $1 'nonce-${nonce}'`
    );
    headers.set('content-security-policy', updatedCsp);
  }

  return new Response(injected, {
    status: response.status || 200,
    headers,
  });
};
