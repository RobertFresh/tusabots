// lib/auth.js
//
// Auth state management, session helpers, auth-gated fetch, and sign-in utilities.
// Phase 2: enforces session presence; redirects unauthenticated users.
//
// IMPLEMENTATION: direct Supabase REST API calls (no @supabase/supabase-js,
// no ES modules, no import maps).  The vendor/supabase-rest.js module handles
// all HTTP calls to the Supabase auth endpoints.
//
// Change log:
//   - Removed @supabase/supabase-js import; replaced with vendor/supabase-rest.js
//     to eliminate the need for import maps and ES module bare specifier resolution.
export * from './vendor/supabase-rest.js';