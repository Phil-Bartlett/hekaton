import { describe, expect, it } from "vitest";
import { claudeArgs, HOOK_EVENTS, launchEnv, NESTED_SESSION_MARKERS, sessionSettings } from "../src/main/launch.js";

describe("claudeArgs", () => {
  it("passes a fresh session id when not resuming", () => {
    expect(claudeArgs({ name: "Frontend", model: "opus", sessionId: "abc" })).toEqual([
      "--name",
      "Frontend",
      "--model",
      "opus",
      "--session-id",
      "abc",
    ]);
  });

  it("prefers --resume over --session-id and keeps --settings on resume", () => {
    expect(claudeArgs({ sessionId: "new", resume: "old", settingsPath: "C:/x.json" })).toEqual([
      "--settings",
      "C:/x.json",
      "--resume",
      "old",
    ]);
  });

  it("spreads extra directories after a single --add-dir", () => {
    expect(claudeArgs({ addDirs: ["C:/a", "C:/b"] })).toEqual(["--add-dir", "C:/a", "C:/b"]);
  });

  it("omits every flag without a value", () => {
    expect(claudeArgs({})).toEqual([]);
  });
});

describe("launchEnv", () => {
  it("strips nested-session markers and keeps everything else", () => {
    const base = Object.fromEntries(NESTED_SESSION_MARKERS.map((key) => [key, "x"]));
    base.PATH = "C:/bin";
    base.CLAUDE_CODE_GIT_BASH_PATH = "C:/Git/bin/bash.exe";
    const env = launchEnv(base, { HEKATON_INSTANCE: "id-1" });
    for (const key of NESTED_SESSION_MARKERS) expect(env).not.toHaveProperty(key);
    expect(env.PATH).toBe("C:/bin");
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe("C:/Git/bin/bash.exe");
    expect(env.HEKATON_INSTANCE).toBe("id-1");
  });

  it("does not mutate the base environment", () => {
    const base = { CLAUDECODE: "1" };
    launchEnv(base, {});
    expect(base.CLAUDECODE).toBe("1");
  });
});

describe("sessionSettings", () => {
  const settings = sessionSettings({
    hookUrl: "http://127.0.0.1:4000/hook/abc",
    statusUrl: "http://127.0.0.1:4000/status/abc",
    relayScript: "C:\\Users\\phil\\hekaton\\scripts\\statusline-relay.sh",
    userStatusLine: 'bash "C:/Users/phil/.claude/statusline.sh"',
  });

  it("registers one curl hook for every lifecycle event", () => {
    expect(Object.keys(settings.hooks)).toEqual(HOOK_EVENTS);
    for (const entries of Object.values(settings.hooks)) {
      expect(entries[0].hooks[0].command).toBe('curl -s -m 2 --data-binary @- "http://127.0.0.1:4000/hook/abc"');
      expect(entries[0].hooks[0].timeout).toBe(5);
    }
  });

  it("chains the relay to the user's statusline with forward slashes and escaped quotes", () => {
    expect(settings.statusLine).toEqual({
      type: "command",
      command:
        'bash "C:/Users/phil/hekaton/scripts/statusline-relay.sh" "http://127.0.0.1:4000/status/abc" "bash \\"C:/Users/phil/.claude/statusline.sh\\""',
    });
  });

  it("omits the user command when there is none", () => {
    const bare = sessionSettings({ hookUrl: "h", statusUrl: "s", relayScript: "r.sh" });
    expect(bare.statusLine.command).toBe('bash "r.sh" "s"');
  });
});
