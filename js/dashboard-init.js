// dashboard-init.js
// Local mode detection + auth module loader.
// Must run before dashboard-bots.js.
// Extracted from inline <script> blocks to comply with CSP (no 'unsafe-inline').

(function () {
  const _hn = window.location.hostname;
  const _isLocal = (_hn === 'localhost' || _hn === '127.0.0.1' || /^192\.168\./.test(_hn) || /^10\./.test(_hn));

  if (_isLocal) {
    // No Supabase auth needed on LAN — provide stubs
    window.authFetch = (url, opts) => fetch(url, opts);
    window.getCurrentUser = () => ({ email: 'local@pi' });
    window.isLoggedIn = () => true;

    // Show nav for local mode
    const navRight = document.getElementById('nav-right');

    const homeBtn = document.createElement('a');
    homeBtn.href = 'http://localhost:8484';
    homeBtn.textContent = '🏠';
    homeBtn.title = 'Back to Launcher';
    homeBtn.style.cssText = 'font-size:1.4rem;text-decoration:none;cursor:pointer;transition:transform 0.2s;';
    homeBtn.onmouseenter = () => homeBtn.style.transform = 'scale(1.2)';
    homeBtn.onmouseleave = () => homeBtn.style.transform = 'scale(1)';
    navRight.appendChild(homeBtn);

    const badge = document.createElement('span');
    badge.className = 'nav-user-email';
    badge.textContent = '📡 Local Mode';
    navRight.appendChild(badge);
  } else {
    // Cloud mode — load the real auth module
    const s = document.createElement('script');
    s.type = 'module';
    s.src = '/js/dashboard-auth.js';
    document.head.appendChild(s);
  }
})();
