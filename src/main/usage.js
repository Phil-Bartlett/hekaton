import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { claudeHome } from "./claudeConfig.js";

// Rate limits ride on every statusline post (Pro and Max accounts), so the
// freshest post from any session is the account-wide figure. The rolling
// 31-day total comes from the cache the user's statusline maintains, read
// only when its mtime changes.
export function createUsage() {
  let rateLimits = null;
  let at = null;
  let rolling = null;
  let rollingMtime = 0;
  const cacheFile = path.join(claudeHome(), "token-usage-cache.json");

  function update(payload) {
    if (!payload?.rate_limits) return;
    rateLimits = payload.rate_limits;
    at = Date.now();
  }

  function readRolling() {
    let mtime;
    try {
      mtime = statSync(cacheFile).mtimeMs;
    } catch {
      return null;
    }
    if (mtime === rollingMtime) return rolling;
    rollingMtime = mtime;
    try {
      const cache = JSON.parse(readFileSync(cacheFile, "utf8"));
      rolling =
        typeof cache.cost_total === "number"
          ? { costUsd: cache.cost_total, tokens: cache.total ?? null, days: 31, at: mtime }
          : null;
    } catch {
      rolling = null;
    }
    return rolling;
  }

  return { update, current: () => ({ rateLimits, at, rolling: readRolling() }) };
}
