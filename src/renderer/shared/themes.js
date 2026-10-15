import { contrastRatio, isLight, mix } from "./color.js";

// Built-in colour themes. Every pair of text on background clears WCAG AA
// (4.5:1 for text, 3:1 for the accent); test/themes.test.js enforces it.
export const THEMES = Object.freeze({
  dark: { label: "Dark", bg: "#1a1a1a", bgElevated: "#242424", fg: "#d4d4d4", fgMuted: "#929292", accent: "#22c55e" },
  midnight: {
    label: "Midnight",
    bg: "#0f1420",
    bgElevated: "#182033",
    fg: "#d6deef",
    fgMuted: "#8d9bb8",
    accent: "#5b8def",
  },
  aurora: {
    label: "Aurora",
    bg: "#101418",
    bgElevated: "#17202a",
    fg: "#d8e6ee",
    fgMuted: "#8aa3b3",
    accent: "#22d3ee",
  },
  light: { label: "Light", bg: "#f5f5f5", bgElevated: "#ffffff", fg: "#1f2937", fgMuted: "#59616f", accent: "#1d4ed8" },
  hacker: {
    label: "Hacker",
    bg: "#000000",
    bgElevated: "#0a0f0a",
    fg: "#39ff14",
    fgMuted: "#2fa31a",
    accent: "#39ff14",
  },
});

export const TEXT_CONTRAST = 4.5;
export const ACCENT_CONTRAST = 3;

// Contrast problems in a theme, as sentences the editor can show. Empty
// means the theme meets AA everywhere text is drawn.
export function themeIssues(theme) {
  const issues = [];
  const check = (label, fg, bg, minimum) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio < minimum) issues.push(`${label} is ${ratio.toFixed(1)}:1, needs ${minimum}:1`);
  };
  check("Text on background", theme.fg, theme.bg, TEXT_CONTRAST);
  check("Text on panels", theme.fg, theme.bgElevated, TEXT_CONTRAST);
  check("Muted text on background", theme.fgMuted, theme.bg, TEXT_CONTRAST);
  check("Muted text on panels", theme.fgMuted, theme.bgElevated, TEXT_CONTRAST);
  check("Accent on background", theme.accent, theme.bg, ACCENT_CONTRAST);
  return issues;
}

export function resolveTheme(name, customThemes = {}) {
  return customThemes[name] ?? THEMES[name] ?? THEMES.dark;
}

// The greys every stylesheet uses, derived from the base colour so a theme
// only has to pick five colours.
export function deriveVariables(theme) {
  const light = isLight(theme.bg);
  const towards = light ? "#000000" : "#ffffff";
  const step = (amount) => mix(theme.bg, towards, amount);
  return {
    "--bg": theme.bg,
    "--bg-elevated": theme.bgElevated,
    "--surface": step(light ? 0.04 : 0.03),
    "--control": step(light ? 0.08 : 0.07),
    "--control-hover": step(light ? 0.13 : 0.11),
    "--control-active": step(light ? 0.19 : 0.16),
    "--border": step(light ? 0.12 : 0.09),
    "--border-strong": step(light ? 0.26 : 0.18),
    "--track": step(light ? 0.16 : 0.13),
    "--tray": mix(theme.bg, "#000000", light ? 0.03 : 0.25),
    "--fg": theme.fg,
    "--fg-muted": theme.fgMuted,
    "--ui-accent": theme.accent,
  };
}

export function applyTheme(theme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(deriveVariables(theme))) root.style.setProperty(name, value);
  root.style.colorScheme = isLight(theme.bg) ? "light" : "dark";
}
