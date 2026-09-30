// Canvas renderer for the voice-call screen: a star field and Luna as a
// moon whose phase tells the state of the call —
//   idle      a crescent, like the app icon (waiting for you)
//   listening waxes to a full moon; its corona swells while you talk
//   thinking  waxes and wanes
//   speaking  full moon; corona and tide rings follow Luna's real voice
// Framework-free on purpose (MoonCanvas.jsx drives it) so it can also be
// previewed on its own. Honours prefers-reduced-motion by drawing still
// frames only when something changes.

const TAU = Math.PI * 2;
const TILT = -0.42; // radians — the lit side faces up-right, like the logo
const DPR_CAP = 2;

const LIT_TARGET = { idle: 0.3, listening: 1, speaking: 1, thinking: 0.62, error: 0.18 };
const CORONA_RGB = { listening: "207,224,255", speaking: "196,181,253" };

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The lunar surface, drawn once per size into an offscreen canvas: a
// lavender-silver disc, darker "seas", craters lit from the up-right and
// limb darkening. Seeded, so it looks the same on every open.
function buildMoonTexture(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const r = size / 2;
  const rand = mulberry32(20260930);
  g.save();
  g.beginPath();
  g.arc(r, r, r, 0, TAU);
  g.clip();

  const base = g.createRadialGradient(r * 1.18, r * 0.8, r * 0.05, r, r, r * 1.02);
  base.addColorStop(0, "#fdfbff");
  base.addColorStop(0.42, "#e4dcfb");
  base.addColorStop(0.78, "#b3a4ec");
  base.addColorStop(1, "#8574d0");
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);

  for (let i = 0; i < 7; i++) {
    const x = r + (rand() - 0.5) * r * 1.25;
    const y = r + (rand() - 0.5) * r * 1.25;
    const rad = r * (0.16 + rand() * 0.3);
    const m = g.createRadialGradient(x, y, 0, x, y, rad);
    m.addColorStop(0, "rgba(96,74,172,0.22)");
    m.addColorStop(0.6, "rgba(96,74,172,0.12)");
    m.addColorStop(1, "rgba(96,74,172,0)");
    g.fillStyle = m;
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();
  }

  // Light comes from the up-right, so rims catch it there.
  const light = -Math.PI / 4;
  for (let i = 0; i < 46; i++) {
    const d = Math.sqrt(rand()) * r * 0.92;
    const a = rand() * TAU;
    const x = r + Math.cos(a) * d;
    const y = r + Math.sin(a) * d;
    const cr = r * (0.012 + Math.pow(rand(), 3) * 0.058);
    // Soft floor instead of a flat disc — reads as a dip, not a sticker.
    const floor = g.createRadialGradient(x, y, 0, x, y, cr);
    floor.addColorStop(0, `rgba(74,56,146,${0.1 + rand() * 0.08})`);
    floor.addColorStop(1, "rgba(74,56,146,0.02)");
    g.fillStyle = floor;
    g.beginPath();
    g.arc(x, y, cr, 0, TAU);
    g.fill();
    g.lineWidth = Math.max(0.6, cr * 0.16);
    g.strokeStyle = `rgba(255,255,255,${0.05 + rand() * 0.07})`;
    g.beginPath();
    g.arc(x, y, cr, light - 1, light + 1);
    g.stroke();
    g.strokeStyle = `rgba(44,30,104,${0.06 + rand() * 0.06})`;
    g.beginPath();
    g.arc(x, y, cr, light + Math.PI - 1, light + Math.PI + 1);
    g.stroke();
  }

  for (let i = 0; i < 320; i++) {
    const d = Math.sqrt(rand()) * r;
    const a = rand() * TAU;
    g.fillStyle = rand() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(60,44,130,0.05)";
    g.fillRect(r + Math.cos(a) * d, r + Math.sin(a) * d, 1.2, 1.2);
  }

  const limb = g.createRadialGradient(r, r, r * 0.55, r, r, r);
  limb.addColorStop(0, "rgba(36,24,92,0)");
  limb.addColorStop(1, "rgba(36,24,92,0.42)");
  g.fillStyle = limb;
  g.fillRect(0, 0, size, size);
  g.restore();
  return c;
}

// Dark side of the moon for a lit fraction k (0 new … 1 full), light from +x.
function shadowPath(ctx, R, k) {
  ctx.beginPath();
  ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, true); // limb, through the left
  // Terminator back to the top: bulges right for a crescent, left for a gibbous.
  ctx.ellipse(0, 0, Math.max(0.001, R * Math.abs(1 - 2 * k)), R, 0, Math.PI / 2, -Math.PI / 2, k < 0.5);
  ctx.closePath();
}

const easeOut = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export function createMoonScene(canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext("2d");
  const canBlur = "filter" in ctx;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let anchor = { x: 0.5, y: 0.4, maxR: 120 }; // moon centre (px) + size budget
  let R = 60;
  let tex = null;
  let texPx = 0;
  let stars = [];

  let state = "idle";
  let levelSource = null; // () => 0..1 (speaking)
  let lit = 0.02;         // start as a new moon and rise into the state
  let level = 0;
  let activity = 0;       // listening: bumps on every new word, decays
  let rings = [];
  let lastRing = 0;
  let startT = null;
  let lastT = null;
  let raf = 0;
  let running = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    // Assigning width/height clears the bitmap even to the same value —
    // only do it on a real size change.
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const rand = mulberry32(7);
    const count = Math.min(240, Math.round((W * H) / 7000));
    stars = Array.from({ length: count }, () => ({
      x: rand() * W,
      y: rand() * H,
      r: 0.35 + Math.pow(rand(), 3) * 1.25,
      base: 0.18 + rand() * 0.55,
      speed: 0.4 + rand() * 1.6,
      phase: rand() * TAU,
    }));
    layoutMoon();
  }

  function layoutMoon() {
    // No big floor: on a short screen the stage is small and the moon must
    // stay inside it rather than cover the text.
    R = Math.max(16, Math.min(anchor.maxR, 172));
    const px = Math.ceil(R * 2 * dpr);
    if (!tex || Math.abs(px - texPx) > 4) {
      tex = buildMoonTexture(px);
      texPx = px;
    }
  }

  function draw(t, dt) {
    const T = t / 1000;
    const enter = reducedMotion ? 1 : easeOut((t - startT) / 900);

    // --- levels (time-based smoothing, so a throttled or slow frame rate
    // changes nothing but smoothness)
    const ease = (rate) => 1 - Math.exp(-dt * rate);
    if (state === "speaking") {
      const target = levelSource ? levelSource() : 0.38 + 0.22 * Math.sin(T * 7.1) * Math.sin(T * 2.3);
      level += (target - level) * ease(target > level ? 30 : 6);
    } else if (state === "listening") {
      activity *= Math.exp(-dt / 0.55);
      level += (0.14 + 0.62 * activity + 0.03 * Math.sin(T * 2) - level) * ease(11);
    } else {
      level += ((state === "thinking" ? 0.12 : 0.05 + 0.03 * Math.sin(T * 0.8)) - level) * ease(5);
    }

    // --- phase
    const target = state === "thinking" && !reducedMotion
      ? 0.52 + 0.4 * Math.sin(T * 1.35)
      : LIT_TARGET[state] ?? 0.3;
    lit = reducedMotion ? target : lit + (target - lit) * ease(state === "thinking" ? 6 : 2.6);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // --- stars
    const starFade = reducedMotion ? 1 : easeOut((t - startT) / 1400);
    for (const s of stars) {
      const tw = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(T * s.speed + s.phase);
      ctx.globalAlpha = s.base * tw * starFade;
      ctx.fillStyle = "#ece6ff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const cx = anchor.x;
    const cy = anchor.y + (1 - enter) * 22;
    const scale = 0.94 + 0.06 * enter;
    const Rs = R * scale;

    // --- halo
    const glow = 0.25 + 0.75 * lit;
    const haloR = Rs * (1.85 + 1.1 * level);
    const halo = ctx.createRadialGradient(cx, cy, Rs * 0.85, cx, cy, haloR);
    halo.addColorStop(0, `rgba(190,172,255,${(0.2 * glow + 0.22 * level) * enter})`);
    halo.addColorStop(0.45, `rgba(139,108,246,${(0.08 * glow + 0.1 * level) * enter})`);
    halo.addColorStop(1, "rgba(139,108,246,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR, 0, TAU);
    ctx.fill();

    // --- tide rings (speaking)
    if (state === "speaking" && !reducedMotion && level > 0.14 && T - lastRing > 0.55 - 0.3 * level) {
      rings.push({ born: T, strength: Math.min(1, level * 1.15) });
      lastRing = T;
      if (rings.length > 7) rings.shift();
    }
    rings = rings.filter((ring) => T - ring.born < 2.6);
    for (const ring of rings) {
      const age = (T - ring.born) / 2.6;
      ctx.strokeStyle = `rgba(196,181,253,${0.3 * ring.strength * Math.pow(1 - age, 1.6)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, Rs * (1.14 + 1.55 * easeOut(age)), 0, TAU);
      ctx.stroke();
    }

    // --- corona (listening / speaking)
    const rgb = CORONA_RGB[state];
    if (rgb) {
      ctx.save();
      ctx.strokeStyle = `rgba(${rgb},${(0.22 + 0.4 * level) * enter})`;
      ctx.lineWidth = 1.2;
      ctx.shadowColor = `rgba(${rgb},0.85)`;
      // shadowBlur and filter blur ignore the dpr transform — scale by hand.
      ctx.shadowBlur = (10 + 14 * level) * dpr;
      ctx.beginPath();
      const amp = reducedMotion ? 0 : Rs * 0.085 * level;
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * TAU;
        const wob = 0.5 * Math.sin(2 * a + T * 1.6) + 0.32 * Math.sin(4 * a - T * 2.2 + 1.3) + 0.18 * Math.sin(7 * a + T * 3.1);
        const rr = Rs * 1.07 + amp * (0.5 + 0.5 * wob);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // --- the moon
    ctx.save();
    ctx.globalAlpha = enter;
    ctx.translate(cx, cy);
    // Glow grows with the lit area, so a crescent doesn't outline the whole
    // dark disc.
    ctx.shadowColor = `rgba(186,168,255,${0.15 + 0.5 * lit * lit})`;
    ctx.shadowBlur = Rs * (0.08 + 0.4 * lit * lit + 0.3 * level) * dpr;
    ctx.beginPath();
    ctx.arc(0, 0, Rs, 0, TAU);
    ctx.fillStyle = "#0b0918";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.drawImage(tex, -Rs, -Rs, Rs * 2, Rs * 2);
    if (lit < 0.995) {
      ctx.rotate(TILT);
      ctx.beginPath();
      ctx.arc(0, 0, Rs + 0.5, 0, TAU);
      ctx.clip();
      if (canBlur) ctx.filter = `blur(${Math.max(1, Rs * 0.025) * dpr}px)`;
      // Earthshine: the dark side stays just barely visible. Full opacity
      // even while the moon fades in, so it rises as a crescent, not a disc.
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(8,6,20,0.955)";
      shadowPath(ctx, Rs + 1, lit);
      ctx.fill();
      if (canBlur) ctx.filter = "none";
    }
    ctx.restore();
  }

  function loop(t) {
    if (!running) return;
    if (startT === null) startT = t;
    const dt = lastT === null ? 0.016 : Math.min(0.5, (t - lastT) / 1000);
    lastT = t;
    draw(t, dt);
    raf = requestAnimationFrame(loop);
  }

  function renderStill() {
    if (startT === null) startT = 0;
    draw(performance.now(), 0);
  }

  function start() {
    if (reducedMotion) {
      renderStill();
      return;
    }
    if (running) return;
    running = true;
    lastT = null;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);

  resize();
  start();

  // After a resize the canvas may have been cleared; repaint right away so
  // the browser never shows a blank frame before the next tick.
  function redrawNow() {
    if (reducedMotion) renderStill();
    else if (running && lastT !== null) draw(lastT, 0);
  }

  return {
    resize() {
      resize();
      redrawNow();
    },
    setAnchor(x, y, maxR) {
      anchor = { x, y, maxR };
      layoutMoon();
      redrawNow();
    },
    setState(next) {
      if (next === state) return;
      state = next;
      if (next !== "speaking") rings = [];
      if (reducedMotion) renderStill();
    },
    setLevelSource(fn) {
      levelSource = fn;
    },
    pulse() {
      activity = 1;
    },
    destroy() {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
