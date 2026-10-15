// Pure helpers for building a Claude Code launch; kept free of node-pty so
// they can be unit-tested under plain Node.

// A Claude Code process marks its own subprocesses with these so that a
// Claude started from inside a tool call is treated as a nested child
// (transcript saving off, session attended, shared messaging socket).
// Hekaton may itself be started from such a shell during development, and
// every session it launches must be a fresh top-level one.
export const NESTED_SESSION_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_SIMPLE",
  "CLAUDE_CODE_SAFE_MODE",
  "CLAUDE_EFFORT",
  "CLAUDE_ENV_FILE",
  "CLAUDE_PID",
  "CLAUDE_PROJECT_DIR",
];

// A fresh session is named after its profile. A resumed conversation keeps
// whatever name Claude already holds for it, unless Hekaton recorded one
// (the case after a move, where a path resume loses it).
export function launchName(profile) {
  if (!profile.resume) return profile.name;
  return profile.sessionName || undefined;
}

export function claudeArgs({
  name,
  model,
  effort,
  permissionMode,
  skipPermissions,
  addDirs = [],
  settingsPath,
  sessionId,
  resume,
}) {
  const args = [];
  if (name) args.push("--name", name);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (permissionMode) args.push("--permission-mode", permissionMode);
  if (skipPermissions) args.push("--dangerously-skip-permissions");
  if (addDirs.length) args.push("--add-dir", ...addDirs);
  if (settingsPath) args.push("--settings", settingsPath);
  if (resume) {
    args.push("--resume", resume);
  } else if (sessionId) {
    args.push("--session-id", sessionId);
  }
  return args;
}

// Whatever launched Hekaton may have had colour switched off (a tool
// shell, a CI runner); the terminal here is a full colour xterm regardless.
const NO_COLOUR_MARKERS = ["NO_COLOR", "FORCE_COLOR"];

export function launchEnv(baseEnv, extra) {
  const env = { ...baseEnv };
  for (const key of [...NESTED_SESSION_MARKERS, ...NO_COLOUR_MARKERS]) delete env[key];
  if (!env.TERM || env.TERM === "dumb") env.TERM = "xterm-256color";
  return { ...env, ...extra };
}

// Every lifecycle event the state machine in state.js understands.
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "StopFailure",
  "PreCompact",
  "PostCompact",
  "SessionEnd",
];

const HOOK_TIMEOUT_SECONDS = 5;

function bashPath(file) {
  return file.replace(/\\/g, "/");
}

// The settings object handed to Claude via --settings for one session. Hooks
// merge additively with the user's own; statusLine replaces theirs for this
// session only, which is why the relay chains back to their command. URLs are
// baked in as literals so no shell has to expand a variable.
export function sessionSettings({ hookUrl, statusUrl, relayScript, userStatusLine }) {
  const command = `curl -s -m 2 --data-binary @- "${hookUrl}"`;
  const hooks = Object.fromEntries(
    HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] }]]),
  );
  const relayArgs = [`"${bashPath(relayScript)}"`, `"${statusUrl}"`];
  if (userStatusLine) relayArgs.push(`"${userStatusLine.replace(/"/g, '\\"')}"`);
  return { hooks, statusLine: { type: "command", command: `bash ${relayArgs.join(" ")}` } };
}
