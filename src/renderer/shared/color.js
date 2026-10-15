// Small colour maths for themes and status pills: WCAG 2 relative luminance
// and contrast, plus mixing for the greys a theme derives from its base.

export function parseHex(hex) {
  const value = hex.trim().replace(/^#/, "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

export function toHex([r, g, b]) {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

// Black or white, whichever reads better on the given background.
export function readableOn(background) {
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#ffffff") ? "#000000" : "#ffffff";
}

// Blend `amount` (0..1) of `towards` into `base`.
export function mix(base, towards, amount) {
  const a = parseHex(base);
  const b = parseHex(towards);
  if (!a || !b) return base;
  return toHex(a.map((v, i) => v + (b[i] - v) * amount));
}

export function isLight(hex) {
  return relativeLuminance(hex) > 0.4;
}
