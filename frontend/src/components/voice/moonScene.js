// Canvas renderer for the voice-call screen: a star field and Luna as a
// moon whose phase tells the state of the call —
//   idle      a crescent, like the app icon (waiting for you)
//   listening waxes to a full moon in cool, silver-blue light; its corona
//             swells while you talk
//   thinking  waxes and wanes, starting from wherever the moon already is
//   speaking  full moon in warm lavender light; only the corona and the
//             tide rings follow Luna's real voice, the halo just breathes
//   paused    her reply was paused from outside the app: a calm, nearly
//             full moon, breathing slowly
// plus two one-off moments: flare() when your words are sent and exit(),
// a moonset, when the call ends.
// Framework-free on purpose (MoonCanvas.jsx drives it) so it can also be
// previewed on its own. Honours prefers-reduced-motion by drawing still
// frames only when something changes.
//
// Kept cheap for mid-range phones: the moon (texture + blurred phase
// shadow) is cached and re-drawn only when its phase moves, its glow is a
// pre-rendered sprite, and frames are capped — 60 fps while someone is
// talking, 30 fps otherwise.

const TAU = Math.PI * 2;
const TILT = -0.42; // radians — the lit side faces up-right, like the logo
const DPR_CAP = 2;

const LIT_TARGET = { idle: 0.3, listening: 1, speaking: 1, thinking: 0.62, paused: 0.9, error: 0.18 };
const NEW_MOON = 0.02;
// Thinking swings the lit fraction around THINK_MID by ±THINK_AMP.
const THINK_MID = 0.52;
const THINK_AMP = 0.4;
const THINK_SPEED = 1.35; // rad/s

// Your turn is cool, silver-blue moonlight; Luna's turn (and everything
// else) the app's warm lavender.
const HALO_WARM = [[190, 172, 255], [139, 108, 246]]; // inner, outer
const HALO_COOL = [[190, 210, 255], [99, 122, 241]];
const GLOW_WARM = [186, 168, 255];
const GLOW_COOL = [184, 204, 255];
const CORONA_WARM = [196, 181, 253];
const CORONA_COOL = [207, 224, 255];

const LAYER_PAD = 2;   // css px kept around the disc in the cached moon layer
const SHADE_MAX = 160; // px — the phase shadow is soft, so it is drawn small and scaled up
const FLARE_MS = 500;
const METEOR_S = 1.1;  // a shooting star's life
const EXIT_MS = 440;   // the React side unmounts ~460 ms after exit()
const FAST_FPS = 60;
const SLOW_FPS = 30;
const FRAME_SLACK = 3; // ms of rAF jitter the frame cap tolerates

// Alpha for a CSS colour string: fixed-point, never "1e-7" or negative.
const alpha = (x) => Math.min(1, Math.max(0, x)).toFixed(4);

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

// The moon's glow as a sprite: a disc of radius R blurred by sigma (what a
// shadowBlur of 2·sigma would draw), so the frame loop only has to
// drawImage it with an alpha. Smooth, so it is stored at low resolution.
function buildGlowSprite(R, sigma, rgb, dpr) {
  const ext = R + sigma * 3.5;
  const size = Math.ceil(ext * 2 * Math.min(dpr, Math.max(0.5, 2 / sigma)));
  const k = size / (ext * 2);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Logistic stand-in for the blurred edge (Gaussian CDF), 0.5 on the limb.
  const edge = (r) => 1 / (1 + Math.exp((1.702 * (r - R)) / sigma));
  const from = Math.max(0, R - sigma * 2.5);
  grad.addColorStop(0, `rgba(${rgb},${alpha(edge(0))})`);
  for (let i = 0; i <= 24; i++) {
    const r = from + ((ext - from) * i) / 24;
    grad.addColorStop(Math.min(1, (r * k) / (size / 2)), `rgba(${rgb},${i === 24 ? 0 : alpha(edge(r))})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return { canvas: c, ext };
}

// Dark side of the moon for a lit fraction k (0 new … 1 full), light from +x.
function shadowPath(ctx, R, k) {
  ctx.beginPath();
  ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, true); // limb, through the left
  // Terminator back to the top: bulges right for a crescent, left for a gibbous.
  ctx.ellipse(0, 0, Math.max(0.001, R * Math.abs(1 - 2 * k)), R, 0, Math.PI / 2, -Math.PI / 2, k < 0.5);
  ctx.closePath();
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const smooth = (x) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
const smoothstep = (a, b, x) => smooth((x - a) / (b - a));
const rgbMix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",");

// flare(): a quick soft rise, then a longer settle — a bloom, not a flash.
const flareEnvelope = (u) => (u <= 0 || u >= 1 ? 0 : u < 0.3 ? smooth(u / 0.3) : 1 - smooth((u - 0.3) / 0.7));

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
  let glows = null;
  let stars = [];

  // Cached moon: texture + phase shadow, re-rendered only when the phase
  // moves (or the size changes). The shadow is drawn into a small canvas
  // and scaled up, which blurs it for a fraction of a full-size filter.
  const layer = document.createElement("canvas");
  const layerCtx = layer.getContext("2d");
  const shade = document.createElement("canvas");
  const shadeCtx = shade.getContext("2d");
  let layerLit = -1; // lit the layer was drawn for; -1 = stale

  let state = "idle";
  let stateT = 0;         // s, when the current state began
  let levelSource = null; // () => 0..1 (speaking)
  let lit = NEW_MOON;     // start as a new moon and rise into the state
  let litVel = 0;         // lit/s, smoothed — which way the moon is moving
  let thinkPhase = 0;
  let level = 0;          // fast: drives the corona and the tide rings
  let haloLevel = 0;      // slow: the halo breathes instead of pumping
  let activity = 0;       // listening: bumps on every new word, decays
  let coronaMix = 0;
  let coolMix = 0;        // 0 warm (Luna) … 1 cool (you)
  let ringMix = 0;
  let rings = [];
  let lastRing = 0;
  let meteors = [];
  let nextMeteor = null;  // s, when the next shooting star may appear
  let flareT = null;
  let exitT = null;
  let exitLit = 0;
  let done = false;       // moonset finished — the canvas stays empty
  let startT = null;
  let lastT = null;
  let nextDue = 0;
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
    // The few brightest stars get a soft four-point glint.
    for (const s of stars) s.glint = s.r > 1.18;
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
      // Glow of a crescent (tight) and of a full moon (wide), each in both
      // tints; the frame loop cross-fades them by lit and turn.
      const tight = R * 0.04;
      const wide = R * 0.24;
      glows = {
        R,
        tight: [buildGlowSprite(R, tight, GLOW_WARM, dpr), buildGlowSprite(R, tight, GLOW_COOL, dpr)],
        wide: [buildGlowSprite(R, wide, GLOW_WARM, dpr), buildGlowSprite(R, wide, GLOW_COOL, dpr)],
      };
    }
    layerLit = -1;
  }

  function renderMoonLayer(k) {
    const E = R + LAYER_PAD;
    const px = Math.ceil(E * 2 * dpr);
    if (layer.width !== px) layer.width = layer.height = px;
    const u = px / (E * 2); // layer px per css px
    const g = layerCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    g.setTransform(u, 0, 0, u, px / 2, px / 2);
    g.drawImage(tex, -R, -R, R * 2, R * 2);
    if (k < 0.995) {
      const S = Math.min(SHADE_MAX, px);
      if (shade.width !== S) shade.width = shade.height = S;
      const v = S / (E * 2); // shade px per css px
      const s = shadeCtx;
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.clearRect(0, 0, S, S);
      s.setTransform(v, 0, 0, v, S / 2, S / 2);
      s.rotate(TILT);
      // Filter blur ignores the transform — scale it to this canvas by hand.
      if (canBlur) s.filter = `blur(${Math.max(1, R * 0.025) * v}px)`;
      // Earthshine: the dark side stays faintly visible, never a black hole in the sky.
      s.fillStyle = "rgba(9,7,22,0.92)";
      shadowPath(s, R + 1, k);
      s.fill();
      if (canBlur) s.filter = "none";
      g.save();
      g.beginPath();
      g.arc(0, 0, R + 0.5, 0, TAU);
      g.clip();
      g.drawImage(shade, -E, -E, E * 2, E * 2);
      g.restore();
    }
    // A thin bright rim on the sunlit limb — gives the disc volume. The lit
    // limb is always the +x half in the tilted frame, whatever the phase.
    if (k > 0.04) {
      g.save();
      g.rotate(TILT);
      const w = Math.max(1, R * 0.02);
      const rim = g.createLinearGradient(-R, 0, R, 0);
      rim.addColorStop(0.5, "rgba(255,255,255,0)");
      rim.addColorStop(1, `rgba(255,255,255,${(0.35 + 0.25 * k).toFixed(3)})`);
      g.strokeStyle = rim;
      g.lineWidth = w;
      g.beginPath();
      g.arc(0, 0, R - w / 2, -Math.PI * 0.47, Math.PI * 0.47);
      g.stroke();
      g.restore();
    }
    layerLit = k;
  }

  function clearCanvas() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function draw(t, dt) {
    const T = t / 1000;
    const enter = reducedMotion ? 1 : easeOut((t - startT) / 900);

    // --- moonset: wane toward a new moon, sink and fade, then stay empty
    let out = 0;
    if (exitT !== null) {
      out = clamp01((t - exitT) / EXIT_MS);
      if (out >= 1) {
        clearCanvas();
        done = true;
        stop();
        return;
      }
    }
    const fade = 1 - smooth(out);
    const vis = enter * fade;

    // --- levels (time-based smoothing, so a throttled or slow frame rate
    // changes nothing but smoothness)
    const ease = (rate) => 1 - Math.exp(-dt * rate);
    // Mixes snap under reduced motion (its still frames have dt = 0).
    const approach = (v, target, rate) => (reducedMotion ? target : v + (target - v) * ease(rate));
    if (state === "speaking") {
      const target = levelSource ? levelSource() : 0.38 + 0.22 * Math.sin(T * 7.1) * Math.sin(T * 2.3);
      level += (target - level) * ease(target > level ? 30 : 6);
    } else if (state === "listening") {
      activity *= Math.exp(-dt / 0.55);
      level += (0.14 + 0.62 * activity + 0.03 * Math.sin(T * 2) - level) * ease(11);
    } else if (state === "paused") {
      level += (0.1 + 0.08 * Math.sin(T * 0.9) - level) * ease(3); // slow breath
    } else {
      level += ((state === "thinking" ? 0.12 : 0.05 + 0.03 * Math.sin(T * 0.8)) - level) * ease(5);
    }
    haloLevel += (level - haloLevel) * ease(1.5);

    // --- phase
    if (exitT !== null) {
      lit = exitLit + (NEW_MOON - exitLit) * (1 - Math.pow(1 - out, 2));
    } else {
      // Thinking continues from the lit value it started at (see setState).
      const target = state === "thinking" && !reducedMotion
        ? THINK_MID + THINK_AMP * Math.cos(thinkPhase + THINK_SPEED * (T - stateT))
        : LIT_TARGET[state] ?? 0.3;
      const prev = lit;
      lit = reducedMotion ? target : lit + (target - lit) * ease(state === "thinking" ? 3.5 : 2.6);
      if (dt > 0) litVel += ((lit - prev) / dt - litVel) * ease(8);
    }

    const talking = state === "listening" || state === "speaking";
    coronaMix = approach(coronaMix, talking ? 1 : 0, 4);
    coolMix = approach(coolMix, state === "listening" ? 1 : 0, 7); // ~400 ms
    ringMix = approach(ringMix, state === "speaking" ? 1 : 0, 2.5);
    const flareAmt = flareT === null ? 0 : flareEnvelope((t - flareT) / FLARE_MS);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // --- stars
    const starFade = (reducedMotion ? 1 : easeOut((t - startT) / 1400)) * fade;
    ctx.fillStyle = "#ece6ff";
    for (const s of stars) {
      const tw = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(T * s.speed + s.phase);
      ctx.globalAlpha = s.base * tw * starFade;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
      if (s.glint) {
        const g = s.r * (4 + 3 * tw);
        ctx.globalAlpha = 0.5 * s.base * tw * tw * starFade;
        ctx.fillRect(s.x - g, s.y - 0.35, g * 2, 0.7);
        ctx.fillRect(s.x - 0.35, s.y - g, 0.7, g * 2);
      }
    }
    ctx.globalAlpha = 1;

    // --- a shooting star now and then (not while Luna speaks — she has the
    // stage then). Drawn before the halo and moon, so it passes behind them.
    if (!reducedMotion && exitT === null) {
      if (nextMeteor === null) nextMeteor = T + 8 + Math.random() * 7;
      if (T >= nextMeteor && state !== "speaking" && state !== "error") {
        const fromLeft = Math.random() < 0.5;
        meteors.push({
          born: T,
          x: W * (fromLeft ? 0.06 + Math.random() * 0.3 : 0.64 + Math.random() * 0.3),
          y: H * (0.04 + Math.random() * 0.16),
          ang: (fromLeft ? 0.42 : Math.PI - 0.42) + (Math.random() - 0.5) * 0.3,
          len: Math.min(W, H) * (0.18 + Math.random() * 0.12),
        });
        nextMeteor = T + 15 + Math.random() * 15;
      }
    }
    meteors = meteors.filter((mt) => T - mt.born < METEOR_S);
    for (const mt of meteors) {
      const age = (T - mt.born) / METEOR_S;
      const travel = easeOut(age) * mt.len * 2.2;
      const hx = mt.x + Math.cos(mt.ang) * travel;
      const hy = mt.y + Math.sin(mt.ang) * travel;
      const tail = mt.len * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, age * 1.4)));
      const tx = hx - Math.cos(mt.ang) * tail;
      const ty = hy - Math.sin(mt.ang) * tail;
      const a = Math.sin(Math.PI * age) * 0.85 * fade;
      const trail = ctx.createLinearGradient(hx, hy, tx, ty);
      trail.addColorStop(0, `rgba(245,242,255,${alpha(a)})`);
      trail.addColorStop(1, "rgba(200,190,255,0)");
      ctx.strokeStyle = trail;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(hx, hy, 1.3, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const cx = anchor.x;
    const cy = anchor.y + (1 - enter) * 22 + smooth(out) * 16;
    const scale = 0.94 + 0.06 * enter;
    const Rs = R * scale;

    // --- halo (slow: it breathes with her phrases, not her syllables)
    const glow = 0.25 + 0.75 * lit;
    const haloR = Rs * (1.85 + 0.7 * haloLevel + 0.18 * flareAmt);
    const inner = rgbMix(HALO_WARM[0], HALO_COOL[0], coolMix);
    const outer = rgbMix(HALO_WARM[1], HALO_COOL[1], coolMix);
    const halo = ctx.createRadialGradient(cx, cy, Rs * 0.85, cx, cy, haloR);
    halo.addColorStop(0, `rgba(${inner},${alpha((0.2 * glow + 0.22 * haloLevel + 0.15 * flareAmt) * vis)})`);
    halo.addColorStop(0.45, `rgba(${outer},${alpha((0.08 * glow + 0.1 * haloLevel + 0.05 * flareAmt) * vis)})`);
    halo.addColorStop(1, `rgba(${outer},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR, 0, TAU);
    ctx.fill();

    // --- tide rings (speaking); when she stops they drift out and fade
    if (state === "speaking" && !reducedMotion && exitT === null && level > 0.14 && T - lastRing > 0.55 - 0.3 * level) {
      rings.push({ born: T, strength: Math.min(1, level * 1.15) });
      lastRing = T;
      if (rings.length > 7) rings.shift();
    }
    rings = rings.filter((ring) => T - ring.born < 2.6);
    if (ringMix * vis > 0.004) {
      ctx.lineWidth = 1;
      for (const ring of rings) {
        const age = (T - ring.born) / 2.6;
        ctx.strokeStyle = `rgba(196,181,253,${alpha(0.3 * ring.strength * Math.pow(1 - age, 1.6) * ringMix * vis)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, Rs * (1.14 + 1.55 * easeOut(age)), 0, TAU);
        ctx.stroke();
      }
    }

    // --- corona (listening / speaking). Fades in as the moon fills, so it
    // never outlines a dark disc, and changes colour between turns.
    const coronaA = coronaMix * smoothstep(0.55, 0.95, lit) * vis;
    if (coronaA > 0.004) {
      const rgb = rgbMix(CORONA_WARM, CORONA_COOL, coolMix);
      ctx.save();
      ctx.strokeStyle = `rgba(${rgb},${alpha((0.22 + 0.4 * level) * coronaA)})`;
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

    // --- the moon's glow. Grows with the lit area, so a crescent doesn't
    // outline the whole dark disc.
    const m = lit * lit;
    const glowA = (0.15 + 0.5 * m + 0.1 * flareAmt) * vis;
    const gk = (R / glows.R) * scale;
    const sprites = [
      [glows.tight[0], (1 - m) * (1 - coolMix)],
      [glows.tight[1], (1 - m) * coolMix],
      [glows.wide[0], m * (1 - coolMix)],
      [glows.wide[1], m * coolMix],
    ];
    for (const [sprite, weight] of sprites) {
      const a = glowA * weight;
      if (a < 0.003) continue;
      const e = sprite.ext * gk;
      ctx.globalAlpha = a;
      ctx.drawImage(sprite.canvas, cx - e, cy - e, e * 2, e * 2);
    }

    // --- the moon. The layer is opaque across the disc, so fading it in
    // keeps the dark side dark: it rises as a crescent, not a disc.
    if (layerLit < 0 || Math.abs(lit - layerLit) > 0.003) renderMoonLayer(lit);
    const E = (R + LAYER_PAD) * scale;
    ctx.globalAlpha = vis;
    ctx.drawImage(layer, cx - E, cy - E, E * 2, E * 2);
    ctx.globalAlpha = 1;
  }

  // Someone is talking, or a one-off moment is playing: full rate (capped
  // at 60). Otherwise little moves, so 30 fps is enough.
  function frameInterval(t) {
    const fast = state === "listening" || state === "speaking" || exitT !== null || meteors.length > 0
      || t - startT < 1400 || (flareT !== null && t - flareT < FLARE_MS);
    return 1000 / (fast ? FAST_FPS : SLOW_FPS);
  }

  function loop(t) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (startT === null) startT = t;
    if (t < nextDue - FRAME_SLACK) return; // skip: easing is dt-based, so nothing drifts
    const interval = frameInterval(t);
    // Stay on the frame grid, but don't try to catch up after a stall.
    nextDue = Math.max(nextDue + interval, t + interval / 2);
    const dt = lastT === null ? 0.016 : Math.min(0.5, (t - lastT) / 1000);
    lastT = t;
    draw(t, dt);
  }

  function renderStill() {
    if (done) return;
    if (startT === null) startT = 0;
    draw(performance.now(), 0);
  }

  function start() {
    if (done) return;
    if (reducedMotion) {
      renderStill();
      return;
    }
    if (running) return;
    running = true;
    lastT = null;
    nextDue = 0;
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
    if (done) return;
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
      if (next === "thinking") {
        // Start the wax/wane from the current lit value: waning if the moon
        // is full-ish or already waning, waxing otherwise.
        const c = Math.min(THINK_MID + THINK_AMP, Math.max(THINK_MID - THINK_AMP, lit));
        const a = Math.acos((c - THINK_MID) / THINK_AMP);
        const waxing = Math.abs(litVel) > 0.05 ? litVel > 0 : lit < THINK_MID;
        thinkPhase = waxing ? TAU - a : a;
      }
      state = next;
      stateT = performance.now() / 1000;
      nextDue = 0; // a slow state may be between frames; show the change now
      if (reducedMotion) renderStill();
    },
    setLevelSource(fn) {
      levelSource = fn;
    },
    pulse() {
      activity = 1;
    },
    // The user's turn was sent: one soft bloom of moonlight.
    flare() {
      if (reducedMotion || done || exitT !== null) return;
      flareT = performance.now();
      nextDue = 0;
    },
    // The call is ending: moonset over EXIT_MS, then an empty canvas.
    exit() {
      if (done || exitT !== null) return;
      if (reducedMotion || !running) {
        stop();
        clearCanvas();
        done = true;
        return;
      }
      exitT = performance.now();
      exitLit = lit;
      nextDue = 0;
    },
    destroy() {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
