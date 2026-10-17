import {
  requireAuth,
  authFetch,
  onAuthStateChange,
  getSession,
  signOut,
  signIn,
  signUp,
  handlePostLoginRedirect,
} from '/lib/auth.js';

(async () => {
  const session = await requireAuth('/index.html', window.location.href);
  if (!session) return;

  window.__TUSABOTS_SESSION__ = session;
  window.__TUSABOTS_USER__ = session.user;
  updateNav(session.user?.email);
  console.log('[TusaBots] Auth gate passed —', session.user?.email);
})();

onAuthStateChange((event, session) => {
  window.__TUSABOTS_SESSION__ = session;
  window.__TUSABOTS_USER__ = session?.user ?? null;
  updateNav(session?.user?.email);
  if (!session) {
    console.log('[TusaBots] Session ended — redirecting to login.');
    window.location.href = '/index.html';
  }
});

window.authFetch = authFetch;
window.getCurrentUser = () => window.__TUSABOTS_USER__;
window.isLoggedIn     = () => window.__TUSABOTS_SESSION__ !== null;

function updateNav(email) {
  const navRight = document.getElementById('nav-right');
  navRight.innerHTML = '';
  if (email) {
    const emailSpan = document.createElement('span');
    emailSpan.className = 'nav-user-email';
    emailSpan.textContent = email;
    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'nav-signout';
    signOutBtn.textContent = 'Sign out';
    signOutBtn.addEventListener('click', async () => {
      await signOut();
      window.location.href = '/index.html';
    });
    navRight.appendChild(emailSpan);
    navRight.appendChild(signOutBtn);
  }
}
