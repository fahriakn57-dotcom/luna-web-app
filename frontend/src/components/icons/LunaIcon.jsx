import { useId } from "react";
import { CELESTIAL_ICONS, HUE_RGB } from "@/components/icons/celestialIcons";

// One of Luna's own feature icons (see celestialIcons.js), decorative by
// default — the visible label next to it names the feature.
export function LunaIcon({ name, size = 20, className = "", style }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const icon = CELESTIAL_ICONS[name];
  if (!icon) return null;
  // The markup is static and ships with the app (no user input reaches it);
  // only the {{id}} tokens change, so gradients/masks stay unique per copy.
  const markup = icon.svg.split("{{id}}").join(`${name}-${uid}`);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} overflow="visible" aria-hidden="true" focusable="false"
      className={`shrink-0 ${className}`} style={style} dangerouslySetInnerHTML={{ __html: markup }} />
  );
}

export function hueRgb(name) {
  return HUE_RGB[CELESTIAL_ICONS[name]?.hue] || HUE_RGB.violet;
}

// Tile recipes per size: radius, glyph size, inner/outer glow strength.
const TILES = {
  28: { radius: 9, glyph: 17, inset: "inset 0 -5px 9px -7px", outer: "0 0 10px -4px", drop: "0 5px 12px -8px", glyphGlow: 3, glowA: 0.5 },
  40: { radius: 12, glyph: 22, inset: "inset 0 -7px 13px -9px", outer: "0 0 16px -5px", drop: "0 8px 18px -11px", glyphGlow: 5, glowA: 0.55 },
  56: { radius: 16, glyph: 32, inset: "inset 0 -10px 18px -12px", outer: "0 0 24px -6px", drop: "0 12px 26px -14px", glyphGlow: 7, glowA: 0.65 },
};

// The icon on its glass tile: a dark well lit from behind in the icon's hue,
// a gradient hairline rim and a soft coloured glow — panel headers (40),
// empty states (56) and small rows (28).
export function IconTile({ name, size = 40, className = "" }) {
  const spec = TILES[size] || TILES[40];
  const rgb = hueRgb(name);
  return (
    <span aria-hidden="true" className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: spec.radius,
        border: "1px solid transparent",
        background: [
          `radial-gradient(circle at 50% 50%, rgba(${rgb},.58) 0%, rgba(${rgb},.26) 30%, rgba(${rgb},.07) 55%, rgba(${rgb},0) 72%) padding-box`,
          "radial-gradient(120% 90% at 18% 0%, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 45%) padding-box",
          "linear-gradient(180deg, #1a1133 0%, #0b0618 100%) padding-box",
          `linear-gradient(150deg, rgba(${rgb},.95) 0%, rgba(${rgb},.3) 34%, rgba(${rgb},.08) 60%, rgba(${rgb},.45) 100%) border-box`,
        ].join(", "),
        boxShadow: [
          "inset 0 1px 0 rgba(255,255,255,.1)",
          `${spec.inset} rgba(${rgb},.55)`,
          `${spec.outer} rgba(${rgb},.55)`,
          `${spec.drop} rgba(${rgb},.75)`,
        ].join(", "),
      }}>
      <LunaIcon name={name} size={spec.glyph} style={{ filter: `drop-shadow(0 0 ${spec.glyphGlow}px rgba(${rgb},${spec.glowA}))` }} />
    </span>
  );
}
