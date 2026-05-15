// netlify/edge-functions/inject-env.js
//
// DISABLED — no longer needed after removing @supabase/supabase-js.
// Auth now uses vendor/supabase-rest.js which needs no CDN or import map.
// Keeping this file in place in case we need env var injection for other
// purposes, but it currently passes everything through unchanged.

export default async (request, context) => {
  // Pass every request through without modification.
  return context.next();
}