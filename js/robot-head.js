// Pixel-art Unit-7 head renderer for the landing page.
// Same 11x11 grid as the dashboard tile, scaled up (16px per pixel = 176x176 canvas).
// Animations: eye blink every 3-5s, mouth toggles open/closed while talking.
(function(){
  const canvas = document.getElementById('robot-canvas');
  if (!canvas) return;
  const S = 16; // pixel scale (canvas is 11*16 = 176)
  const ctx = canvas.getContext('2d');

  // Unit-7 colour palette (matches dashboard-bots.js guard/unit-7 colours)
  const COLORS = {
    body:   '#ff4444',
    dark:   '#cc2222',
    eye:    '#ffe066',
    accent: '#ff7777',
    mouth:  '#cc2222',
  };

  // 11x11 grid: 0=empty, 1=body, 2=dark(frame), 3=eye, 4=accent, 5=mouth
  const BASE_GRID = [
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

  // Deep-copy grid for animation state
  let grid = BASE_GRID.map(r => [...r]);

  const colorMap = {
    0: null, // transparent
    1: COLORS.body,
    2: COLORS.dark,
    3: COLORS.eye,
    4: COLORS.accent,
    5: COLORS.mouth,
  };

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 11; x++) {
        const c = colorMap[grid[y][x]];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x * S, y * S, S, S);
      }
    }
  }

  // ── Blink animation ──────────────────────────────────────────────────────
  let blinkTimeout = null;

  function blink() {
    // Squash eyes: turn eye pixels (row 4-5, cols 3+7) to body colour
    grid[4][3] = 1; grid[4][7] = 1;
    grid[5][3] = 1; grid[5][7] = 1;
    draw();
    setTimeout(() => {
      grid[4][3] = 3; grid[4][7] = 3;
      grid[5][3] = 3; grid[5][7] = 3;
      draw();
    }, 130);
  }

  function scheduleBlink() {
    const delay = 3000 + Math.random() * 2000;
    blinkTimeout = setTimeout(() => {
      if (!talking) blink();
      scheduleBlink();
    }, delay);
  }
  scheduleBlink();

  // ── Talk animation (mouth toggles) ───────────────────────────────────────
  let talking = false, talkTimer = null, mouthOpen = false;

  function startTalking() {
    if (talking) return;
    talking = true;
    mouthOpen = false;
    talkTimer = setInterval(() => {
      mouthOpen = !mouthOpen;
      // Open mouth = widen mouth pixels; closed = normal
      if (mouthOpen) {
        // Open: extend mouth to rows 7-8
        grid[7][4] = 5; grid[7][5] = 5; grid[7][6] = 5;
        grid[8][4] = 5; grid[8][5] = 5; grid[8][6] = 5;
      } else {
        // Closed: restore row 8 to body
        grid[8][4] = 1; grid[8][5] = 1; grid[8][6] = 1;
        grid[7][4] = 5; grid[7][5] = 5; grid[7][6] = 5;
      }
      draw();
    }, 180);
  }

  function stopTalking() {
    talking = false;
    clearInterval(talkTimer); talkTimer = null;
    // Reset mouth to base
    grid[7][4] = 5; grid[7][5] = 5; grid[7][6] = 5;
    grid[8][4] = 1; grid[8][5] = 1; grid[8][6] = 1;
    draw();
  }

  // Expose for public-chat.js (same contract as the old SVG version)
  window.robotHead = { startTalking, stopTalking };

  // ── Click to blink (fun interaction) ─────────────────────────────────────
  canvas.addEventListener('click', () => { blink(); });

  // Initial draw
  draw();
})();
