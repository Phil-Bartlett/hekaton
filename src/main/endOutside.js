import { execFile } from "node:child_process";
import { resourcePath } from "./platform.js";
import { alive } from "./registry.js";

const POLL_MS = 250;
const GRACE_MS = 8000;

// Windows has no signal a console program can catch, so a helper types /exit
// into the session's own console: Claude then restores the terminal, runs
// its SessionEnd hooks and removes its registry entry, as it would for its
// user. Elsewhere SIGTERM does the same job.
export function helperCommand(scriptPath, pid) {
  return [
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-TargetPid", String(pid)],
  ];
}

function askToQuit(pid) {
  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Gone already.
    }
    return Promise.resolve();
  }
  const [command, args] = helperCommand(resourcePath("scripts", "end-session.ps1"), pid);
  return new Promise((resolve) => execFile(command, args, { windowsHide: true, timeout: 15_000 }, () => resolve()));
}

function waitForExit(pid, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (!alive(pid)) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

// Ask first; force only a session that will not go.
export async function endOutsideSession(pid) {
  if (!alive(pid)) return { ended: true, forced: false };
  await askToQuit(pid);
  if (await waitForExit(pid, GRACE_MS)) return { ended: true, forced: false };
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Exited between the check and the kill.
  }
  return { ended: await waitForExit(pid, 2000), forced: true };
}
