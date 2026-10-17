(function(){
  const svg = document.getElementById('robot-svg');
  const mouth = document.getElementById('robot-mouth');
  const eyeL = document.getElementById('eye-l');
  const eyeR = document.getElementById('eye-r');
  if (!svg || !mouth) return;

  // Mouth shapes (SVG path d-attributes). Closed = gentle smile; open frames
  // = speaking. We cycle through the open frames while talking.
  const MOUTH_SMILE = 'M 82 138 Q 100 150 118 138';                 // resting smile
  const MOUTH_OPEN  = 'M 84 134 Q 100 162 116 134 Q 100 150 84 134';// wide open oval
  const MOUTH_MID   = 'M 84 137 Q 100 150 116 137 Q 100 144 84 137';// half open
  const TALK_FRAMES = [MOUTH_OPEN, MOUTH_MID, MOUTH_SMILE, MOUTH_MID];

  let talking = false, talkTimer = null, frame = 0, blinkTimeout = null;

  function startTalking() {
    if (talking) return;
    talking = true; frame = 0;
    talkTimer = setInterval(() => {
      mouth.setAttribute('d', TALK_FRAMES[frame % TALK_FRAMES.length]);
      frame++;
    }, 130);
  }
  function stopTalking() {
    talking = false;
    clearInterval(talkTimer); talkTimer = null;
    mouth.setAttribute('d', MOUTH_SMILE);
  }

  // Reusable blink: squash both eyes briefly.
  function blink() {
    if (!eyeL || !eyeR) return;
    eyeL.setAttribute('ry', '1'); eyeR.setAttribute('ry', '1');
    setTimeout(() => { eyeL.setAttribute('ry', '7'); eyeR.setAttribute('ry', '7'); }, 130);
  }

  // Idle auto-blink every 3-5s (skip while talking).
  function scheduleBlink() {
    const delay = 3000 + Math.random() * 2000;
    blinkTimeout = setTimeout(() => {
      if (!talking) blink();
      scheduleBlink();
    }, delay);
  }
  scheduleBlink();

  // Expose for chat logic (unchanged contract: startTalking / stopTalking)
  window.robotHead = { startTalking, stopTalking };

  // ── Interactivity: works with mouse AND touch (unified pointer events) ──
  //   • click-hold + drag  → rotates the head with the cursor/finger
  //   • double-click / double-tap → full 360° spin
  //   • single tap/click on an eye → blink
  let rotation = 0, dragging = false, dragStartAngle = 0, rotAtDragStart = 0, moved = false;
  let lastTapTime = 0;

  function angleFromCenter(x, y) {
    const rect = svg.getBoundingClientRect();
    return Math.atan2(y - (rect.top + rect.height/2), x - (rect.left + rect.width/2)) * 180 / Math.PI;
  }
  function apply() { svg.style.transform = 'rotate(' + rotation + 'deg)'; }
  function spin() { rotation += 360; apply(); }

  // Map a screen point to SVG user coordinates (accounts for CSS rotation),
  // so we can tell whether a tap landed on an eye even when the head is spun.
  function isEyeTap(clientX, clientY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return false;
    const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const HIT = 26; // generous tap radius in viewBox units (eyes are small)
    const dL = Math.hypot(p.x - 80, p.y - 106);
    const dR = Math.hypot(p.x - 120, p.y - 106);
    return dL < HIT || dR < HIT;
  }

  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true; moved = false;
    dragStartAngle = angleFromCenter(e.clientX, e.clientY);
    rotAtDragStart = rotation;
    svg.classList.add('dragging');
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta = angleFromCenter(e.clientX, e.clientY) - dragStartAngle;
    if (Math.abs(delta) > 3) moved = true;
    rotation = rotAtDragStart + delta;
    apply();
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    svg.classList.remove('dragging');
    try { svg.releasePointerCapture(e.pointerId); } catch (_) {}

    if (moved) return; // it was a drag, not a tap — do nothing extra

    // It was a tap/click. Eye tap → blink.
    if (isEyeTap(e.clientX, e.clientY)) { blink(); lastTapTime = 0; return; }

    // Otherwise, detect a double-tap (mainly for touch, where dblclick is flaky).
    const now = Date.now();
    if (now - lastTapTime < 320) { spin(); lastTapTime = 0; }
    else { lastTapTime = now; }
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // Desktop double-click (redundant with double-tap, but snappier with a mouse).
  svg.addEventListener('dblclick', () => { if (!moved) spin(); });
})();
