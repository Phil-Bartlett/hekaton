export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Separate from formatElapsed: an age against an absolute past timestamp can
// span days or weeks, where the stopwatch form (used for the live session
// timer) would read "300h". Keep both — they serve different scales.
export function formatAge(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(total / 3600);
  const days = Math.floor(total / 86400);
  const weeks = Math.floor(total / 604800);
  if (weeks) return `${weeks}w ${days % 7}d`;
  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m`;
  return `${total}s`;
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

export function formatGbp(usd, fx) {
  return `£${((usd ?? 0) * (fx?.rate ?? 0)).toFixed(2)}`;
}

// Hover text for a pound figure: the true dollar amount and the rate used.
export function moneyTitle(usd, fx) {
  const rate = fx?.rate ? fx.rate.toFixed(4) : "?";
  return `${formatUsd(usd)} at ${rate} USD→GBP${fx?.stale ? " (rate may be stale)" : ""}`;
}

export function formatClock(epochMs) {
  return new Date(epochMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
