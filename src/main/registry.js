import { readdirSync, readFileSync, watch } from "node:fs";
import path from "node:path";
import { claudeHome } from "./claudeConfig.js";

const DEBOUNCE_MS = 400;
const POLL_MS = 10_000;

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Claude Code keeps one small JSON file per running session under
// ~/.claude/sessions. The format is undocumented, so every field is optional
// and anything unreadable is skipped; a stale file for a dead pid is ignored.
export function readRegistry(dir = path.join(claudeHome(), "sessions")) {
  let files;
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const rows = [];
  for (const name of files) {
    try {
      const entry = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
      if (!entry.sessionId || !entry.pid || !alive(entry.pid)) continue;
      rows.push({
        pid: entry.pid,
        sessionId: entry.sessionId,
        name: entry.name ?? null,
        cwd: entry.cwd ?? null,
        status: entry.status ?? null,
        statusSince: entry.statusUpdatedAt ?? entry.startedAt ?? null,
        startedAt: entry.startedAt ?? null,
        version: entry.version ?? null,
      });
    } catch {
      // Partially written file or a format this version does not understand.
    }
  }
  return rows.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

export function watchRegistry(onChange) {
  const dir = path.join(claudeHome(), "sessions");
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => onChange(readRegistry(dir)), DEBOUNCE_MS);
  };
  let watcher = null;
  try {
    watcher = watch(dir, fire);
    watcher.on("error", () => {});
  } catch {
    // The folder appears once Claude Code has run at least once; polling covers it.
  }
  const poll = setInterval(fire, POLL_MS);
  fire();
  return () => {
    clearInterval(poll);
    clearTimeout(timer);
    watcher?.close();
  };
}
