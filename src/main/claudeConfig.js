import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Read-only view of the user's Claude Code configuration.
export function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

// The statusLine the user configured, so a session's relay can chain to it.
export function userStatusLineCommand() {
  try {
    const settings = JSON.parse(readFileSync(path.join(claudeHome(), "settings.json"), "utf8"));
    return settings.statusLine?.type === "command" ? settings.statusLine.command : null;
  } catch {
    return null;
  }
}
