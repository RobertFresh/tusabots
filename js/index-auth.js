import { signIn, signUp, getSession, handlePostLoginRedirect } from '/lib/auth.js';

// If already logged in, redirect to dashboard
(async () => {
  const { session } = await getSession();
  if (session) {
    window.location.href = '/dashboard.html';
    return;
  }
})();

// Login button opens modal
document.getElementById('login-btn').addEventListener('click', () => {
  document.getElementById('auth-modal').classList.add('visible');
});
document.getElementById('auth-close').addEventListener('click', () => {
  document.getElementById('auth-modal').classList.remove('visible');
});
// Click outside modal to close
document.getElementById('auth-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove('visible');
  }
});

// Tab switching
let authMode = 'signin';
function setMode(mode) {
  authMode = mode;
  document.getElementById('tab-signin').classList.toggle('active', mode === 'signin');
  document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('auth-submit-btn').textContent = mode === 'signin' ? 'Sign In' : 'Create Account';

  const switchText = document.getElementById('auth-switch-text');
  if (mode === 'signin') {
    switchText.textContent = '';
    switchText.append("Don't have an account? ");
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'auth-switch-btn';
    btn.textContent = 'Sign up';
    btn.addEventListener('click', () => setMode('signup'));
    switchText.appendChild(btn);
  } else {
    switchText.textContent = '';
    switchText.append('Already have an account? ');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'auth-switch-btn';
    btn.textContent = 'Sign in';
    btn.addEventListener('click', () => setMode('signin'));
    switchText.appendChild(btn);
  }
  clearError();
}
window.setMode = setMode;
document.getElementById('tab-signin').addEventListener('click', () => setMode('signin'));
document.getElementById('tab-signup').addEventListener('click', () => setMode('signup'));
document.getElementById('auth-switch-btn').addEventListener('click', () => setMode(authMode === 'signin' ? 'signup' : 'signin'));

function showError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}
function clearError() {
  document.getElementById('auth-error').style.display = 'none';
}
function setLoading(loading) {
  const btn = document.getElementById('auth-submit-btn');
  const email = document.getElementById('auth-email');
  const pw = document.getElementById('auth-password');
  btn.disabled = loading;
  email.disabled = loading;
  pw.disabled = loading;
  btn.textContent = loading ? (authMode === 'signin' ? 'Signing in…' : 'Creating account…') : (authMode === 'signin' ? 'Sign In' : 'Create Account');
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  clearError();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) { showError('Please fill in all fields.'); return; }
  setLoading(true);
  try {
    const result = authMode === 'signin'
      ? await signIn({ email, password })
      : await signUp({ email, password });
    if (result.error) {
      showError(result.error.message || 'Authentication failed.');
    } else {
      window.location.href = '/dashboard.html';
    }
  } catch (err) {
    showError('Connection error. Please check your network and try again.');
  } finally {
    setLoading(false);
  }
}

// Attach form submit via addEventListener (instead of inline onsubmit)
document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);
