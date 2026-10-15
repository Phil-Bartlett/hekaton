// Built-in colour themes as CSS custom-property sets. A custom theme is the
// same shape saved by the user; `applyTheme` writes whichever is chosen
// onto :root so every stylesheet picks it up.
export const THEMES = Object.freeze({
  dark: { label: "Dark", bg: "#1a1a1a", bgElevated: "#242424", fg: "#d4d4d4", fgMuted: "#8a8a8a", accent: "#22c55e" },
  midnight: {
    label: "Midnight",
    bg: "#0f1420",
    bgElevated: "#182033",
    fg: "#d6deef",
    fgMuted: "#8391ad",
    accent: "#5b8def",
  },
  aurora: {
    label: "Aurora",
    bg: "#101418",
    bgElevated: "#17202a",
    fg: "#d8e6ee",
    fgMuted: "#7f98a8",
    accent: "#22d3ee",
  },
  light: { label: "Light", bg: "#f5f5f5", bgElevated: "#ffffff", fg: "#1f2937", fgMuted: "#6b7280", accent: "#2563eb" },
  hacker: {
    label: "Hacker",
    bg: "#000000",
    bgElevated: "#0a0f0a",
    fg: "#39ff14",
    fgMuted: "#1f8f0f",
    accent: "#39ff14",
  },
});

export function resolveTheme(name, customThemes = {}) {
  return customThemes[name] ?? THEMES[name] ?? THEMES.dark;
}

export function applyTheme(theme) {
  const root = document.documentElement.style;
  root.setProperty("--bg", theme.bg);
  root.setProperty("--bg-elevated", theme.bgElevated);
  root.setProperty("--fg", theme.fg);
  root.setProperty("--fg-muted", theme.fgMuted);
  root.setProperty("--ui-accent", theme.accent);
  document.documentElement.style.colorScheme = theme.bg.toLowerCase() === "#f5f5f5" ? "light" : "dark";
}
