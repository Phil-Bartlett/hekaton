import { execFile } from "node:child_process";
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
        // "cli" for a terminal, "sdk-cli" for a headless child of
        // `claude remote-control`, "claude-desktop" for the desktop app.
        entrypoint: entry.entrypoint ?? null,
        remoteControlId: entry.bridgeSessionId ?? null,
        procStart: entry.procStart ?? null,
      });
    } catch {
      // Partially written file or a format this version does not understand.
    }
  }
  return rows.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

const startKey = (row) => `${row.pid}/${row.procStart}`;

// A registry file outlives a Claude that was killed, and the system may hand
// its pid to another program, so a live pid alone does not prove the session
// is. `verdicts` holds what is known so far: a row not yet checked, or one
// that could not be, is kept.
export function sameProcess(row, verdicts) {
  return verdicts.get(startKey(row)) !== false;
}

// Claude records its process start time as a Windows FILETIME, which is what
// .NET reports for a pid. Calls back with pid -> FILETIME string for every
// pid PowerShell could see.
function processStarts(pids, done) {
  const script = `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.StartTime.ToFileTimeUtc())" }`;
  execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true },
    (_error, stdout) => {
      const found = new Map();
      for (const line of String(stdout ?? "").split(/\r?\n/)) {
        const [pid, start] = line.trim().split(" ");
        if (pid && start) found.set(Number(pid), start);
      }
      done(found);
    },
  );
}

export function watchRegistry(onChange) {
  const dir = path.join(claudeHome(), "sessions");
  let timer = null;
  const verdicts = new Map();
  let asking = false;

  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const rows = readRegistry(dir);
      verify(rows);
      onChange(rows.filter((row) => sameProcess(row, verdicts)));
    }, DEBOUNCE_MS);
  };

  // The start time format has only been checked on Windows, so elsewhere a
  // live pid is taken at its word.
  function verify(rows) {
    const current = new Set(rows.map(startKey));
    for (const key of verdicts.keys()) if (!current.has(key)) verdicts.delete(key);
    const unknown = rows.filter((row) => row.procStart && !verdicts.has(startKey(row)));
    if (process.platform !== "win32" || asking || unknown.length === 0) return;
    asking = true;
    processStarts(
      unknown.map((row) => row.pid),
      (found) => {
        asking = false;
        for (const row of unknown) {
          const real = found.get(row.pid);
          if (real !== undefined) verdicts.set(startKey(row), real === row.procStart);
        }
        fire();
      },
    );
  }
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
