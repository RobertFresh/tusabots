// lib/supabase.js
//
// Lightweight Supabase auth client — httpOnly cookie edition.
//
// Auth tokens are stored in httpOnly cookies managed by the auth-session
// Netlify function.  This module NEVER reads or writes tokens to
// localStorage (except to clear legacy data on first load).
//
// Configuration comes from window.ENV which is injected by the Netlify
// Edge Function.

// ─── Auth-session endpoint ───────────────────────────────────────────────────

const AUTH_SESSION_URL = '/.netlify/functions/auth-session';

async function authSessionFetch(action, extra = {}) {
  const res = await fetch(AUTH_SESSION_URL, {
    method: 'POST',
    credentials: 'include',               // send & receive httpOnly cookies
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'Request failed');
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ─── In-memory session state ─────────────────────────────────────────────────

let _currentUser = null;         // cached user object (never contains tokens)
let _sessionChecked = false;     // whether we've validated with the server
let _listeners = [];             // auth state change callbacks

function _notifyListeners(event) {
  _listeners.forEach((cb) => {
    try { cb(event, _currentUser); } catch (e) { console.error('[auth] listener error:', e); }
  });
}

// ─── Legacy cleanup ──────────────────────────────────────────────────────────

function clearLegacySession() {
  try { localStorage.removeItem('tusabots_session'); } catch {}
}

// Run once on load
clearLegacySession();

// ─── Auth API ────────────────────────────────────────────────────────────────

/**
 * Sign in with email and password.
 * The auth-session function validates credentials and sets httpOnly cookies.
 * @param {{email: string, password: string}} credentials
 * @returns {{data: {user: object}, error: null} | {data: null, error: {message: string}}}
 */
export async function signIn({ email, password }) {
  try {
    const data = await authSessionFetch('signin', { email, password });
    _currentUser = data.user;
    _sessionChecked = true;
    _notifyListeners('SIGNED_IN');
    return { data, error: null };
  } catch (err) {
    return { data: null, error: { message: err.message || 'Sign in failed' } };
  }
}

/**
 * Sign up with email and password.
 * @param {{email: string, password: string}} credentials
 * @returns {{data: {user: object}, error: null} | {data: null, error: {message: string}}}
 */
export async function signUp({ email, password }) {
  try {
    const data = await authSessionFetch('signup', { email, password });
    _currentUser = data.user;
    _sessionChecked = true;
    _notifyListeners('SIGNED_IN');
    return { data, error: null };
  } catch (err) {
    return { data: null, error: { message: err.message || 'Sign up failed' } };
  }
}

/**
 * Sign out the current user (clear httpOnly cookies via server).
 * @returns {{error: object|null}}
 */
export async function signOut() {
  try {
    await authSessionFetch('signout');
  } catch {
    // Best-effort — cookies may already be gone
  }
  _currentUser = null;
  _sessionChecked = true;
  _notifyListeners('SIGNED_OUT');
  return { error: null };
}

// ─── Session helpers ─────────────────────────────────────────────────────────

/**
 * Get the current session by asking the server to validate the httpOnly cookie.
 * Caches the result in memory for the page lifetime (until signOut or refresh).
 * @param {{forceCheck?: boolean}} options
 * @returns {{session: {user: object}|null, user: object|null}}
 */
export async function getSession({ forceCheck = false } = {}) {
  // Return cached if we've already checked this page load
  if (_sessionChecked && !forceCheck) {
    if (_currentUser) {
      return { session: { user: _currentUser }, user: _currentUser };
    }
    return { session: null, user: null };
  }

  try {
    const data = await authSessionFetch('session');
    _currentUser = data.user;
    _sessionChecked = true;
    return { session: { user: data.user }, user: data.user };
  } catch (err) {
    // 401 = no valid session
    _currentUser = null;
    _sessionChecked = true;
    return { session: null, user: null };
  }
}

export async function getUser() {
  const { user } = await getSession();
  return user;
}

export async function isAuthenticated() {
  const { session } = await getSession();
  return session !== null;
}

// ─── Auth-gated fetch helper ──────────────────────────────────────────────────

/**
 * Wraps fetch() with credentials: 'include' so httpOnly cookies are sent.
 * No Authorization header is added — the server reads the cookie.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
export async function authFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

// ─── Auth state listener ─────────────────────────────────────────────────────

/**
 * Subscribe to auth state changes.
 * @param {(event: string, user: object|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAuthStateChange(callback) {
  _listeners.push(callback);

  // Fire once immediately with the current state
  if (_sessionChecked) {
    const event = _currentUser ? 'SIGNED_IN' : 'INITIAL_SESSION';
    // Wrap user in a session-like object for backward compat
    const sessionObj = _currentUser ? { user: _currentUser, access_token: '(httpOnly)' } : null;
    callback(event, sessionObj);
  } else {
    // Check with server and then fire
    getSession().then(() => {
      const event = _currentUser ? 'SIGNED_IN' : 'INITIAL_SESSION';
      const sessionObj = _currentUser ? { user: _currentUser, access_token: '(httpOnly)' } : null;
      callback(event, sessionObj);
    });
  }

  return () => {
    _listeners = _listeners.filter((cb) => cb !== callback);
  };
}

// ─── Post-login redirect handler ─────────────────────────────────────────────

/**
 * Check the URL for a ?next= param (set by requireAuth on redirect).
 * If the user has a valid session, redirect to the ?next= destination.
 * @returns {boolean} true if a redirect was triggered
 */
export async function handlePostLoginRedirect() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (!next || !next.startsWith('/')) return false;
  const { session } = await getSession();
  if (!session) return false;
  setTimeout(() => { window.location.href = next; }, 200);
  return true;
}

// ─── Auth gate ───────────────────────────────────────────────────────────────

/**
 * Enforces that a valid session exists.
 * If no session, redirects to the login page and returns null.
 * @param {string} redirectTo
 * @param {string} returnTo
 * @returns {Promise<object|null>}
 */
export async function requireAuth(redirectTo = '/index.html', returnTo = window.location.href) {
  const { session } = await getSession({ forceCheck: true });
  if (!session) {
    const target = new URL(redirectTo, window.location.origin);
    target.searchParams.set('next', returnTo);
    window.location.href = target.toString();
    return null;
  }
  return session;
}
