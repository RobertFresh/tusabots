// lib/supabase.js
//
// Lightweight Supabase REST API client — no external dependencies.
//
// Supabase exposes a REST API at /auth/v1/* that accepts the anon key
// in an apikey header.  This module replaces @supabase/supabase-js for
// the auth use-case (sign-in, sign-up, session management, token refresh).
// Configuration comes from window.ENV which is injected by the Netlify
// Edge Function.

const SUPABASE_URL = window.ENV?.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.ENV?.VITE_SUPABASE_ANON_KEY || '';

// ─── Internal fetch wrapper ─────────────────────────────────────────────────

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${options.bearer || ''}`,
      ...(options.headers || {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body.message || body.error_description || 'Request failed'), {
      status: res.status,
      body,
    });
  }
  return body;
}

// ─── Session storage ─────────────────────────────────────────────────────────

const SESSION_KEY = 'tusabots_session';

function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

// ─── Auth API ────────────────────────────────────────────────────────────────

/**
 * Sign in with email and password.
 * @param {{email: string, password: string}} credentials
 * @returns {{user: object, session: object}|{error: object}}
 */
export async function signIn({ email, password }) {
  try {
    const data = await supabaseFetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    saveSession(data);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: { message: err.message || 'Sign in failed' } };
  }
}

/**
 * Sign up with email and password.
 * @param {{email: string, password: string}} credentials
 * @returns {{user: object, session: object}|{error: object}}
 */
export async function signUp({ email, password }) {
  try {
    const data = await supabaseFetch('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    saveSession(data);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: { message: err.message || 'Sign up failed' } };
  }
}

/**
 * Sign out the current user (clear session).
 * @returns {{error: object|null}}
 */
export async function signOut() {
  const session = loadSession();
  clearSession();
  if (session?.access_token) {
    try {
      await supabaseFetch('/auth/v1/logout', {
        method: 'POST',
        bearer: session.access_token,
      });
    } catch {}
  }
  return { error: null };
}

// ─── Session helpers ─────────────────────────────────────────────────────────

export async function getSession() {
  const session = loadSession();
  if (session?.access_token) {
    return { session, user: session.user };
  }
  return { session: null, user: null };
}

export async function getUser() {
  const { session } = await getSession();
  return session?.user ?? null;
}

export async function isAuthenticated() {
  const { session } = await getSession();
  return session !== null;
}

// ─── Auth-gated fetch helper ──────────────────────────────────────────────────

/**
 * Wraps fetch() with the current session's access token as Bearer auth.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
export async function authFetch(url, options = {}) {
  const { session } = await getSession();
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token
        ? { 'Authorization': `Bearer ${session.access_token}` }
        : {}),
      ...(options.headers || {}),
    },
  });
}

// ─── Auth state listener ─────────────────────────────────────────────────────

/**
 * Subscribe to auth state changes.
 * @param {(event: string, session: object|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAuthStateChange(callback) {
  // Poll every 2 seconds to catch tab-close sign-outs in other tabs.
  // Storage events catch cross-tab sign-outs in the same tab.
  const storageKey = SESSION_KEY;
  const onStorage = (e) => {
    if (e.key === storageKey) {
      const raw = e.newValue ? JSON.parse(e.newValue) : null;
      callback(raw ? 'SIGNED_IN' : 'SIGNED_OUT', raw);
    }
  };
  window.addEventListener('storage', onStorage);

  // Also fire once immediately with the current session
  const current = loadSession();
  callback(current ? 'SIGNED_IN' : 'INITIAL_SESSION', current);

  return () => window.removeEventListener('storage', onStorage);
}

// ─── Post-login redirect handler ─────────────────────────────────────────────

/**
 * Check the URL for a ?next= param (set by requireAuth on redirect).
 * If present, navigate there after a short delay.
 * @returns {boolean} true if a redirect was triggered
 */
export function handlePostLoginRedirect() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (next && next.startsWith('/')) {
    setTimeout(() => { window.location.href = next; }, 200);
    return true;
  }
  return false;
}

// ─── Auth gate ───────────────────────────────────────────────────────────────

/**
 * Phase 2: Enforces that a valid session exists.
 * If no session, redirects to the login page and returns null.
 * @param {string} redirectTo
 * @param {string} returnTo
 * @returns {Promise<object|null>}
 */
export async function requireAuth(redirectTo = '/index.html', returnTo = window.location.href) {
  const { session } = await getSession();
  if (!session) {
    const target = new URL(redirectTo, window.location.origin);
    target.searchParams.set('next', returnTo);
    window.location.href = target.toString();
    return null;
  }
  return session;
}