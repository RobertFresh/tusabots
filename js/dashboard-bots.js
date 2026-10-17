// ── Bot Roster ────────────────────────────────────────────
const BOTS = [
  {
    id: 'boss',
    name: 'The Boss',
    model: 'Claude Opus / Sonnet (dual brain)',
    role: 'Lead AI — builds, researches, solves problems',
    security: 'private',
    status: 'online',
    statusLabel: 'Online',
    home: 'Pi (CLI + Telegram)',
    skills: 'Coding, research, file management, life admin, home automation',
    chatEndpoint: null,
    chatUnavailableMsg: 'CLI & Telegram only',
    colors: { body: '#ffc107', dark: '#b8860b', eye: '#0a0a0f', accent: '#ffe066' },
    accentVar: 'var(--bot-boss)',
  },
  {
    id: 'clerk',
    name: 'The Clerk',
    model: 'Claude Sonnet',
    role: 'Routine tasks, logging, maintenance',
    security: 'private',
    status: 'online',
    statusLabel: 'Online',
    home: 'Pi (CLI + Telegram + Web)',
    skills: 'Chat, workspace management, note-taking',
    chatEndpoint: '/.netlify/functions/chat',
    chatUnavailableMsg: null,
    colors: { body: '#4a6cf7', dark: '#2a4cd7', eye: '#e6edf3', accent: '#7b9aff' },
    accentVar: 'var(--bot-clerk)',
  },
  {
    id: 'simpleton',
    name: 'The Simpleton',
    model: 'Ollama qwen2.5:3b (local)',
    role: 'Casual chat, memory keeper, home control',
    security: 'private',
    status: 'online',
    statusLabel: 'Online (via tunnel)',
    home: 'Pi (Telegram)',
    skills: 'Chat, memory, home control',
    chatEndpoint: '/.netlify/functions/ollama-chat',
    chatBotId: 'simpleton',
    chatUnavailableMsg: null,
    colors: { body: '#00ff88', dark: '#00b860', eye: '#0a0a0f', accent: '#66ffb2' },
    accentVar: 'var(--bot-simpleton)',
  },
  {
    id: 'guard',
    name: 'The Guard',
    model: 'Claude Haiku',
    role: 'Public-facing — greets visitors, guards the door',
    security: 'public',
    status: 'cloud',
    statusLabel: 'Online (cloud)',
    home: 'Netlify + Supabase (Unit-7)',
    skills: 'Public chat, visitor interaction',
    chatEndpoint: '/.netlify/functions/public-chat',
    chatHqMode: true,
    chatUnavailableMsg: null,
    colors: { body: '#ff4444', dark: '#cc2222', eye: '#ffe066', accent: '#ff7777' },
    accentVar: 'var(--bot-guard)',
  },
  {
    id: 'commander',
    name: 'The Commander',
    model: 'Pure Python (no AI)',
    role: 'Instant slash commands — radio, projector, solar, status',
    security: 'private',
    status: 'online',
    statusLabel: 'Online',
    home: 'Pi (Telegram)',
    skills: '/skidrow, /solar, /projectoron, /status, /radiooff',
    chatEndpoint: '/.netlify/functions/commander-chat',
    chatBotId: 'commander',
    chatUnavailableMsg: null,
    colors: { body: '#8b949e', dark: '#5a6370', eye: '#e6edf3', accent: '#adb5bd' },
    accentVar: 'var(--bot-commander)',
  },
  {
    id: 'triggbot',
    name: 'TriggBot',
    model: 'Ollama qwen2.5:3b (local)',
    role: 'Roaming social bot — Twitch + YouTube chat, stream companion',
    security: 'public',
    status: 'online',
    statusLabel: 'Online (24/7)',
    home: 'Pi → Twitch IRC + YouTube Live Chat',
    skills: 'Chat, stream companion, cross-platform reader, safety filters',
    chatEndpoint: '/.netlify/functions/ollama-chat',
    chatBotId: 'triggbot',
    chatUnavailableMsg: null,
    colors: { body: '#b44aff', dark: '#8a2be2', eye: '#ffe066', accent: '#d18aff' },
    accentVar: 'var(--bot-triggbot)',
  },
];

// ── Pixel Robot Head Renderer ─────────────────────────────
// 11x11 grid, 4px per pixel = 44x44 canvas (scales via CSS)
function drawRobotHead(canvas, colors) {
  const S = 4; // pixel size
  canvas.width = 11 * S;
  canvas.height = 11 * S;
  const ctx = canvas.getContext('2d');

  // Head shape: 11x11 grid
  // 0=empty, 1=body, 2=dark(frame), 3=eye, 4=accent, 5=mouth
  const grid = [
    [0,0,0,0,2,4,2,0,0,0,0],  // antenna
    [0,0,0,0,0,4,0,0,0,0,0],  // antenna stem
    [0,0,2,2,2,2,2,2,2,0,0],  // top of head
    [0,2,1,1,1,1,1,1,1,2,0],  // upper head
    [0,2,1,3,1,1,1,3,1,2,0],  // eyes row
    [0,2,1,3,1,1,1,3,1,2,0],  // eyes row 2
    [0,2,1,1,1,1,1,1,1,2,0],  // mid face
    [0,2,1,1,5,5,5,1,1,2,0],  // mouth
    [0,2,1,1,1,1,1,1,1,2,0],  // lower face
    [0,0,2,2,2,2,2,2,2,0,0],  // chin
    [0,0,0,2,1,1,1,2,0,0,0],  // neck
  ];

  const colorMap = {
    0: 'transparent',
    1: colors.body,
    2: colors.dark,
    3: colors.eye,
    4: colors.accent,
    5: colors.dark,
  };

  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 11; x++) {
      const c = colorMap[grid[y][x]];
      if (c === 'transparent') continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * S, y * S, S, S);
    }
  }
}

// ── Render Bot Grid ───────────────────────────────────────
const gridEl = document.getElementById('bot-grid');
const panelEl = document.getElementById('bot-panel');
let activeBot = null;

BOTS.forEach(bot => {
  const tile = document.createElement('div');
  tile.className = 'bot-tile';
  tile.dataset.botId = bot.id;
  tile.style.setProperty('--tile-accent', bot.accentVar);
  tile.innerHTML = `
    <span class="bot-status-dot ${bot.status}"></span>
    <div class="bot-head"><canvas></canvas></div>
    <span class="bot-name">${bot.name}</span>
  `;
  gridEl.appendChild(tile);

  // Draw the pixel head
  const canvas = tile.querySelector('canvas');
  drawRobotHead(canvas, bot.colors);

  // Click handler
  tile.addEventListener('click', () => openPanel(bot));
});

// ── Panel Logic ───────────────────────────────────────────
function openPanel(bot) {
  // Toggle off if same bot clicked
  if (activeBot === bot.id) {
    closePanel();
    return;
  }

  // Deactivate previous
  document.querySelectorAll('.bot-tile.active').forEach(t => t.classList.remove('active'));

  // Activate tile
  const tile = document.querySelector(`[data-bot-id="${bot.id}"]`);
  tile.classList.add('active');
  activeBot = bot.id;

  // Build panel content
  const securityBadge = bot.security === 'private'
    ? '<span class="security-badge private">🔒 Private</span>'
    : '<span class="security-badge public">🌐 Public</span>';

  let chatSection = '';
  if (bot.chatEndpoint) {
    chatSection = `
      <div class="panel-chat">
        <div class="panel-chat-messages" id="panel-chat-messages">
          <div class="panel-chat-placeholder">Send a message to ${bot.name}</div>
        </div>
        <div class="panel-chat-input-area">
          <input type="text" class="panel-chat-input" id="panel-chat-input"
                 placeholder="Type a message..." autocomplete="off">
          <button class="panel-chat-send" id="panel-chat-send">Send</button>
        </div>
      </div>`;
  } else if (bot.chatUnavailableMsg) {
    chatSection = `<div class="panel-chat-unavailable">${bot.chatUnavailableMsg}</div>`;
  }

  panelEl.innerHTML = `
    <div class="panel-header">
      <canvas id="panel-head-canvas"></canvas>
      <h2>${bot.name}</h2>
      <button class="panel-close" id="panel-close">✕</button>
    </div>
    <div class="panel-info">
      <span class="label">Model</span>    <span class="value">${bot.model}</span>
      <span class="label">Role</span>     <span class="value">${bot.role}</span>
      <span class="label">Security</span> <span class="value">${securityBadge}</span>
      <span class="label">Status</span>   <span class="value">${bot.statusLabel}</span>
      <span class="label">Home</span>     <span class="value">${bot.home}</span>
      <span class="label">Skills</span>   <span class="value">${bot.skills}</span>
    </div>
    ${chatSection}
  `;

  // Draw panel head
  const panelCanvas = document.getElementById('panel-head-canvas');
  panelCanvas.width = 40; panelCanvas.height = 40;
  drawRobotHead(panelCanvas, bot.colors);

  // Close button
  document.getElementById('panel-close').addEventListener('click', closePanel);

  // Wire up chat if available
  if (bot.chatEndpoint) {
    wireChat(bot);
  }

  // Open with animation
  panelEl.classList.add('open');

  // Scroll panel into view
  setTimeout(() => panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

function closePanel() {
  panelEl.classList.remove('open');
  document.querySelectorAll('.bot-tile.active').forEach(t => t.classList.remove('active'));
  activeBot = null;
}

// ── Chat Wiring (Clerk + Guard HQ mode) ───────────────────
function wireChat(bot) {
  const messagesEl = document.getElementById('panel-chat-messages');
  const inputEl    = document.getElementById('panel-chat-input');
  const sendBtn    = document.getElementById('panel-chat-send');
  const chatHistory = bot._chatHistory || [];
  bot._chatHistory = chatHistory;

  function addBubble(text, type) {
    const ph = messagesEl.querySelector('.panel-chat-placeholder');
    if (ph) ph.remove();
    const div = document.createElement('div');
    div.className = 'chat-bubble ' + type;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setEnabled(on) {
    inputEl.disabled = !on;
    sendBtn.disabled = !on;
    sendBtn.textContent = on ? 'Send' : '...';
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    addBubble(text, 'user');
    setEnabled(false);

    try {
      const payload = bot.chatHqMode
        ? { message: text, history: chatHistory, hqMode: true }
        : bot.chatBotId
        ? { message: text, history: chatHistory, botId: bot.chatBotId }
        : { message: text, history: chatHistory, workspaceId: 'default' };

      const res = await window.authFetch(bot.chatEndpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.status === 401) {
        addBubble('Session expired. Please sign in again.', 'bot');
        window.location.href = '/index.html';
        return;
      }

      const data = await res.json();
      if (data.reply) {
        addBubble(data.reply, 'bot');
        chatHistory.push({ role: 'user', content: text });
        chatHistory.push({ role: 'assistant', content: data.reply });
        if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);
      } else {
        addBubble('Error: ' + (data.detail || data.error || 'Unknown'), 'bot');
      }
    } catch (e) {
      addBubble('Connection error. Try again.', 'bot');
    }

    setEnabled(true);
    inputEl.focus();
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // Load existing history if this bot was already chatted with
  chatHistory.forEach(msg => {
    addBubble(msg.content, msg.role === 'assistant' ? 'bot' : 'user');
  });

  inputEl.focus();
}

// ── Eye blink animation (redraw eyes periodically) ────────
setInterval(() => {
  const canvases = document.querySelectorAll('.bot-tile canvas');
  // Random bot blinks
  const idx = Math.floor(Math.random() * canvases.length);
  const bot = BOTS[idx];
  const canvas = canvases[idx];
  const ctx = canvas.getContext('2d');
  const S = 4;

  // Close eyes (draw body color over eye pixels)
  ctx.fillStyle = bot.colors.body;
  // Left eye: (3,4), (3,5) — Right eye: (7,4), (7,5)
  ctx.fillRect(3*S, 4*S, S, S); ctx.fillRect(3*S, 5*S, S, S);
  ctx.fillRect(7*S, 4*S, S, S); ctx.fillRect(7*S, 5*S, S, S);

  // Reopen after 150ms
  setTimeout(() => {
    ctx.fillStyle = bot.colors.eye;
    ctx.fillRect(3*S, 4*S, S, S); ctx.fillRect(3*S, 5*S, S, S);
    ctx.fillRect(7*S, 4*S, S, S); ctx.fillRect(7*S, 5*S, S, S);
  }, 150);
}, 3000);
