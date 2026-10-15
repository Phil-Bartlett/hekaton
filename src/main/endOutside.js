import { execFile } from "node:child_process";
import { resourcePath } from "./platform.js";
import { alive } from "./registry.js";

const POLL_MS = 250;
const GRACE_MS = 8000;
const SHELL_GRACE_MS = 3000;

// Shells whose tab or window closes when they are told to exit. Anything
// else that launched Claude is left alone.
const SHELLS = new Set([
  "powershell.exe",
  "pwsh.exe",
  "cmd.exe",
  "bash.exe",
  "sh.exe",
  "zsh.exe",
  "fish.exe",
  "nu.exe",
]);

export function isShell(name) {
  return typeof name === "string" && SHELLS.has(name.toLowerCase());
}

// Windows has no signal a console program can catch, so a helper types a
// line into the process's own console, as its user would.
export function helperCommand(scriptPath, pid, line) {
  return [
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-TargetPid",
      String(pid),
      "-Line",
      line,
    ],
  ];
}

// Resolves with the target's parent process, which the helper reports
// because it is unknowable once the target has exited.
function typeInto(pid, line) {
  const [command, args] = helperCommand(resourcePath("scripts", "end-session.ps1"), pid, line);
  return new Promise((resolve) =>
    execFile(command, args, { windowsHide: true, timeout: 15_000 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop()));
      } catch {
        resolve(null);
      }
    }),
  );
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

// Ask the session to quit (Claude restores its terminal, runs SessionEnd and
// drops its registry entry), force it only if it will not go, then close the
// shell that launched it. Off Windows, SIGTERM does the asking and the
// terminal stays: there is no safe way to type into another tty.
export async function endOutsideSession(pid) {
  if (!alive(pid)) return { ended: true, forced: false, closed: false };
  let parent = null;
  if (process.platform === "win32") {
    parent = await typeInto(pid, "/exit");
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Gone already.
    }
  }
  let forced = false;
  if (!(await waitForExit(pid, GRACE_MS))) {
    forced = true;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Exited between the check and the kill.
    }
    if (!(await waitForExit(pid, 2000))) return { ended: false, forced, closed: false };
  }
  if (!parent?.parentPid || !isShell(parent.parentName) || !alive(parent.parentPid)) {
    return { ended: true, forced, closed: false };
  }
  await typeInto(parent.parentPid, "exit");
  return { ended: true, forced, closed: await waitForExit(parent.parentPid, SHELL_GRACE_MS) };
}
