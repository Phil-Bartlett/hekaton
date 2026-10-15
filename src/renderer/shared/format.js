export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return "…";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatElapsed(ms);
}

export function formatTokens(n) {
  return new Intl.NumberFormat("en-GB").format(n ?? 0);
}

export function formatUsd(value) {
  return `$${(value ?? 0).toFixed(4)}`;
}

export function formatClock(epochMs) {
  return new Date(epochMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
