import { useEffect, useRef } from "react";

// Parallax starfield with occasional shooting stars; colour adapts to mode.
export default function StarField({ mode }) {
  const canvasRef = useRef(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf, w, h, stars, shooters;

    const palette = () =>
      modeRef.current === "jarvis" ? [6, 182, 212] : [245, 158, 11];

    let nebulae;

    const resize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      const count = Math.min(320, Math.floor((w * h) / 7000));
      stars = Array.from({ length: count }, () => {
        const depth = Math.random();
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: depth * 2.1 + 0.3,
          vx: (Math.random() - 0.5) * (0.08 + depth * 0.32),
          vy: (Math.random() - 0.5) * (0.08 + depth * 0.32),
          a: Math.random() * 0.6 + 0.25,
          tw: (Math.random() * 0.03 + 0.006) * (Math.random() < 0.5 ? 1 : -1),
          depth,
        };
      });
      shooters = [];
      nebulae = Array.from({ length: 3 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.min(w, h) * (0.35 + Math.random() * 0.25),
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const spawnShooter = () => {
      if (Math.random() < 0.014 && shooters.length < 4) {
        shooters.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.5,
          len: 90 + Math.random() * 140,
          sp: 7 + Math.random() * 8,
          life: 1,
        });
      }
    };

    let t = 0;
    const draw = () => {
      const [r, g, b] = palette();
      t += 0.006;
      ctx.clearRect(0, 0, w, h);

      for (const n of nebulae) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < -n.r) n.x = w + n.r; if (n.x > w + n.r) n.x = -n.r;
        if (n.y < -n.r) n.y = h + n.r; if (n.y > h + n.r) n.y = -n.r;
        const pulse = 0.5 + Math.sin(t + n.phase) * 0.5;
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        grad.addColorStop(0, `rgba(${r},${g},${b},${0.05 + pulse * 0.05})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      for (const s of stars) {
        s.x += s.vx; s.y += s.vy;
        s.a += s.tw;
        if (s.a > 0.85 || s.a < 0.12) s.tw *= -1;
        if (s.x < 0) s.x = w; if (s.x > w) s.x = 0;
        if (s.y < 0) s.y = h; if (s.y > h) s.y = 0;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        const bright = s.depth > 0.7;
        ctx.fillStyle = bright
          ? `rgba(${r},${g},${b},${s.a})`
          : `rgba(226,232,240,${s.a * 0.7})`;
        ctx.fill();
      }

      spawnShooter();
      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        sh.x += sh.sp; sh.y += sh.sp * 0.5; sh.life -= 0.012;
        const grad = ctx.createLinearGradient(sh.x, sh.y, sh.x - sh.len, sh.y - sh.len * 0.5);
        grad.addColorStop(0, `rgba(${r},${g},${b},${sh.life})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(sh.x - sh.len, sh.y - sh.len * 0.5);
        ctx.stroke();
        if (sh.life <= 0 || sh.x > w) shooters.splice(i, 1);
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="starfield-canvas"
      className="fixed inset-0 z-0 pointer-events-none"
    />
  );
}
