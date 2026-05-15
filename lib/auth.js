// lib/auth.js
// Auth state management, session helpers, auth-gated fetch, and sign-in utilities.
// Phase 2: enforces session presence; redirects unauthenticated users.

import { supabase } from './supabase.js';

// ─── Session helpers ────────────────────────────────────────────────────────

/**
 * Returns the current session (access token + user) if one exists.
 * Returns null if no valid session is persisted.
 */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Returns the current user (id, email, metadata) from the session.
 * Returns null if no valid session.
 */
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/**
 * Returns true if a valid session exists.
 */
export async function isAuthenticated() {
  const session = await getSession();
  return session !== null;
}

// ─── Auth gate (Phase 2 enforcement) ───────────────────────────────────────

/**
 * Phase 2: Enforces that a valid session exists.
 * If no session, redirects to the login page and returns null.
 *
 * @param {string} redirectTo - URL to redirect to if no session. Defaults to /index.html
 * @param {string} returnTo   - URL to come back to after successful login. Defaults to current location.
 * @returns {Promise<object|null>} session object, or redirects and returns null
 */
export async function requireAuth(redirectTo = '/index.html', returnTo = window.location.href) {
  const session = await getSession();
  if (!session) {
    // Encode current page so we can redirect back after login
    const target = new URL(redirectTo, window.location.origin);
    target.searchParams.set('next', returnTo);
    window.location.href = target.toString();
    return null;
  }
  return session;
}

// ─── Auth state listener ─────────────────────────────────────────────────────

/**
 * Subscribe to auth state changes (sign in, sign out, token refresh).
 * Returns an unsubscribe function — call it when the component unmounts.
 *
 * @param {(event, session) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

// ─── Auth-gated fetch helper ─────────────────────────────────────────────────

/**
 * A fetch wrapper that attaches the Supabase access token from the current
 * session as a Bearer Authorization header.
 *
 * If no session exists, the request proceeds WITHOUT a token.
 * Server-side enforcement (chat.js / upload.js) will reject with 401.
 *
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
export async function authFetch(url, options = {}) {
  const session = await getSession();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  return fetch(url, { ...options, headers });
}

// ─── Auth sign-in / sign-up / sign-out ──────────────────────────────────────

/**
 * Sign in with email and password.
 * @param {{email: string, password: string}} credentials
 * @returns {{user: object, session: object}|{error: object}}
 */
export async function signIn({ email, password }) {
  return supabase.auth.signInWithPassword({ email, password });
}

/**
 * Sign up with email and password.
 * @param {{email: string, password: string}} credentials
 * @returns {{user: object, session: object}|{error: object}}
 */
export async function signUp({ email, password }) {
  return supabase.auth.signUp({ email, password });
}

/**
 * Sign out the current user.
 * @returns {{error: object|null}}
 */
export async function signOut() {
  return supabase.auth.signOut();
}

// ─── Handle post-login redirect ───────────────────────────────────────────────
/**
 * Check the URL for a ?next= param (set by requireAuth on redirect).
 * If present, navigate there after a short delay (lets the session settle).
 *
 * Call this early in the index page script.
 */
export function handlePostLoginRedirect() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (next && next.startsWith('/')) {
    // Small delay so session is written to storage before we navigate
    setTimeout(() => { window.location.href = next; }, 200);
    return true;
  }
  return false;
}