import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { claudeHome } from "./claudeConfig.js";

// USD to GBP for the pound figures in the UI. Seeded from the statusline's
// own cache when it has one, refreshed from the same public source a few
// times a day, and kept as "last known" when offline.
const SOURCE = "https://open.er-api.com/v6/latest/USD";
const REFRESH_MS = 6 * 60 * 60 * 1000;
const STALE_MS = 48 * 60 * 60 * 1000;
const FALLBACK = { rate: 0.75, at: 0, src: "fallback" };

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// The statusline cache stamps `at` in seconds; ours is milliseconds.
function atMs(fx) {
  return fx.at < 1e12 ? fx.at * 1000 : fx.at;
}

export function createFx() {
  const ownFile = path.join(app.getPath("userData"), "fx.json");
  let fx = readJson(ownFile) ?? readJson(path.join(claudeHome(), "token-usage-cache.json"))?.fx ?? FALLBACK;

  async function refresh() {
    if (Date.now() - atMs(fx) < REFRESH_MS) return;
    try {
      const response = await fetch(SOURCE);
      const rate = (await response.json())?.rates?.GBP;
      if (typeof rate === "number" && rate > 0 && rate < 10) {
        fx = { rate, at: Date.now(), src: "open.er-api.com" };
        writeFileSync(ownFile, JSON.stringify(fx));
      }
    } catch {
      // Offline or blocked: the last known rate stays in use.
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS).unref();

  return {
    current: () => ({ rate: fx.rate, at: atMs(fx), src: fx.src, stale: Date.now() - atMs(fx) > STALE_MS }),
  };
}
