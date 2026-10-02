import { useId } from "react";
import { HUE_RGB } from "@/components/icons/celestialIcons";

// Secondary icons (hobbies, categories, row icons…) are Lucide line glyphs.
// These two wrappers dress them in the same light as Luna's own Celestial
// icons: a luminous gradient stroke (near-white → the hue) with a soft glow,
// bare (GlowIcon) or on the same glass tile as IconTile (GlyphTile).

// "r,g,b" for a hue family name ("violet", "rose", …) or a raw "r,g,b".
export function toRgb(hueOrRgb) {
  if (!hueOrRgb) return HUE_RGB.violet;
  return HUE_RGB[hueOrRgb] || hueOrRgb;
}

// The light end of the gradient: the hue mixed 70% towards white.
function lighten(rgb, amount = 0.7) {
  return rgb.split(",").map((v) => Math.round(Number(v) + (255 - Number(v)) * amount)).join(",");
}

// Gradient in the glyph's own 24x24 user space — objectBoundingBox would
// drop perfectly straight strokes (a zero-height box has no gradient).
function GlyphGradient({ id, rgb }) {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <defs>
        <linearGradient id={id} x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={`rgb(${lighten(rgb, 0.78)})`} />
          <stop offset=".5" stopColor={`rgb(${lighten(rgb, 0.35)})`} />
          <stop offset="1" stopColor={`rgb(${rgb})`} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function GlowIcon({ icon: Icon, hue = "violet", size = 16, strokeWidth = 2, glow = true, className = "" }) {
  const id = `glow-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const rgb = toRgb(hue);
  if (!Icon) return null;
  return (
    <>
      <GlyphGradient id={id} rgb={rgb} />
      <Icon size={size} strokeWidth={strokeWidth} stroke={`url(#${id})`} aria-hidden="true"
        className={`shrink-0 ${className}`}
        style={glow ? { filter: `drop-shadow(0 0 ${Math.max(2, Math.round(size / 6))}px rgba(${rgb},.5))` } : undefined} />
    </>
  );
}

// Same glass well as IconTile, sized freely (24–56px).
export function glassTileStyle(rgb, size) {
  const k = size / 40;
  return {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.3),
    border: "1px solid transparent",
    background: [
      `radial-gradient(circle at 50% 50%, rgba(${rgb},.5) 0%, rgba(${rgb},.22) 30%, rgba(${rgb},.06) 55%, rgba(${rgb},0) 72%) padding-box`,
      "radial-gradient(120% 90% at 18% 0%, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 45%) padding-box",
      "linear-gradient(180deg, #1a1133 0%, #0b0618 100%) padding-box",
      `linear-gradient(150deg, rgba(${rgb},.85) 0%, rgba(${rgb},.28) 34%, rgba(${rgb},.08) 60%, rgba(${rgb},.4) 100%) border-box`,
    ].join(", "),
    boxShadow: [
      "inset 0 1px 0 rgba(255,255,255,.1)",
      `inset 0 ${-Math.round(7 * k)}px ${Math.round(13 * k)}px ${-Math.round(9 * k)}px rgba(${rgb},.5)`,
      `0 0 ${Math.round(14 * k)}px ${-Math.round(5 * k)}px rgba(${rgb},.45)`,
    ].join(", "),
  };
}

export function GlyphTile({ icon, hue = "violet", size = 36, glyph, className = "" }) {
  const rgb = toRgb(hue);
  return (
    <span aria-hidden="true" className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={glassTileStyle(rgb, size)}>
      <GlowIcon icon={icon} hue={rgb} size={glyph || Math.round(size * 0.5)} strokeWidth={size <= 28 ? 2 : 2.1} />
    </span>
  );
}
