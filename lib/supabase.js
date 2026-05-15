// lib/supabase.js
//
// Re-exports from the vendor REST implementation.
// The @supabase/supabase-js package is NOT used — auth and fetch are handled
// via direct Supabase REST API calls (vendor/supabase-rest.js).
// This keeps the module interface compatible with the rest of the codebase.
export * from './vendor/supabase-rest.js';