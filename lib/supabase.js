// lib/supabase.js
// Centralized Supabase client for the frontend.
// Configuration comes from window.ENV (injected by the hosting page).
// This keeps the module environment-agnostic — no build step required.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = window.ENV?.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = window.ENV?.VITE_SUPABASE_ANON_KEY || 'placeholder';

if (!window.ENV?.VITE_SUPABASE_URL || !window.ENV?.VITE_SUPABASE_ANON_KEY) {
  console.warn(
    '[TusaBots] Supabase env vars not set. Auth features will be unavailable.\n' +
    'Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are configured in Netlify.'
  );
}

// Singleton export — import this from any module that needs Supabase access
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Persist session to localStorage so it survives page reloads
    persistSession: true,
    storage: localStorage,
    // Auto-refresh tokens before they expire
    autoRefreshToken: true,
    // Manual redirect handling (Phase 2 will wire redirectTo)
    detectSessionInUrl: false,
  },
});