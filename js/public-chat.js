(function(){
  // ── Visitor identity ─────────────────────────────────────────────────────
  const VISITOR_KEY = 'tusabots_visitor';
  const NAME_KEY = 'tusabots_visitor_name';

  function getVisitorId() {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      // Simple fingerprint: random ID (persists per browser)
      id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  }

  function getVisitorName() {
    let name = localStorage.getItem(NAME_KEY);
    if (!name) {
      name = randomCowboyName();
      localStorage.setItem(NAME_KEY, name);
    }
    return name;
  }

  // Auto-assign a Western/cowboy-movie handle so visitors never see a name prompt.
  function randomCowboyName() {
    const NAMES = [
      'Ringo','Doc Holliday','Wyatt Earp','Django','Josey Wales','Rooster Cogburn',
      'Blondie','Tuco','Shane','Wild Bill','Jesse James','Butch Cassidy',
      'Sundance Kid','Cheyenne','Harmonica','Tex','Cole Younger','The Duke',
      'Maverick','Cassidy','Calamity Jane','Annie Oakley','Billy the Kid',
      'Buffalo Bill','Marshal Dillon','El Indio','Sartana','Trinity',
      'Cimarron','Deadwood Dan','Silverado','Cooper','Bronco','Laramie'
    ];
    const base = NAMES[Math.floor(Math.random() * NAMES.length)];
    return base + ' ' + Math.floor(10 + Math.random() * 90);
  }

  const visitorId = getVisitorId();

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const messagesEl = document.getElementById('chat-messages');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  const visitorName = getVisitorName();  // auto-assigned cowboy name, always set
  let sending = false;

  // No name prompt any more — chat is usable the moment the page loads.
  inputEl.disabled = false;
  sendBtn.disabled = false;

  // ── Supabase Realtime ────────────────────────────────────────────────────
  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON = window.__SUPABASE_ANON_KEY__;
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // Track message IDs to avoid duplicates
  const renderedIds = new Set();

  function addMessage(msg) {
    if (renderedIds.has(msg.id)) return;
    renderedIds.add(msg.id);

    const wrapper = document.createElement('div');
    wrapper.className = 'chat-msg ' + (msg.is_bot ? 'bot' : 'visitor');

    const nameEl = document.createElement('div');
    nameEl.className = 'chat-msg-name' + (msg.is_bot ? ' bot-name' : '');
    nameEl.textContent = msg.sender_name;

    const bubble = document.createElement('div');
    bubble.className = 'chat-msg-bubble';
    bubble.textContent = msg.content;

    wrapper.appendChild(nameEl);
    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Animate robot head for bot messages
    if (msg.is_bot && window.robotHead) {
      window.robotHead.startTalking();
      // Estimate reading time: ~60ms per char, min 1s, max 4s
      const duration = Math.min(4000, Math.max(1000, msg.content.length * 60));
      setTimeout(() => window.robotHead.stopTalking(), duration);
    }
  }

  // Load recent messages
  async function loadRecent() {
    const { data, error } = await supabase
      .from('public_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      console.error('[public-chat] load recent failed:', error.message);
      return;
    }
    // Fetch the NEWEST 50 (desc), then reverse so they render oldest->newest.
    // (Fetching ascending grabbed the OLDEST 50 and hid all recent messages
    //  once the table grew past 50 rows — the "stuck a month ago" bug.)
    (data || []).reverse().forEach(addMessage);
  }

  // Subscribe to new messages via Realtime
  function subscribeRealtime() {
    supabase
      .channel('public-chat')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'public_messages',
      }, (payload) => {
        addMessage(payload.new);
      })
      .subscribe((status) => {
        console.log('[public-chat] realtime status:', status);
      });
  }

  // ── Send message ─────────────────────────────────────────────────────────
  async function sendMessage() {
    if (sending || !visitorName) return;
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    try {
      const res = await fetch('/.netlify/functions/public-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          senderName: visitorName,
          visitorId: visitorId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[public-chat] send failed:', err);
      } else {
        // A "system" reply (e.g. Unit-7's low-power excuse) is NOT saved to the DB
        // and won't arrive via Realtime, so render it locally for this visitor only.
        const data = await res.json().catch(() => ({}));
        if (data && data.system && data.reply) {
          addMessage({ id: 'sys_' + Date.now(), sender_name: 'Unit-7', content: data.reply, is_bot: true });
        }
      }
      // Normal messages + real bot replies arrive via Realtime — no render here.
    } catch (e) {
      console.error('[public-chat] send error:', e);
    }

    sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    inputEl.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  loadRecent();
  subscribeRealtime();
})();
