import { describe, expect, it } from "vitest";
import { applyExit, applyHook, applyStatus, attentionFor, initialTelemetry, STATES } from "../src/main/state.js";

const hook = (name, extra = {}) => ({
  hook_event_name: name,
  session_id: "s1",
  transcript_path: "C:/t/s1.jsonl",
  ...extra,
});

describe("applyHook", () => {
  it("walks launching → idle → running → awaiting approval → idle", () => {
    let t = initialTelemetry(0);
    t = applyHook(t, hook("SessionStart"), 1);
    expect(t.state).toBe(STATES.idle);
    expect(t.claudeSessionId).toBe("s1");
    expect(t.transcriptPath).toBe("C:/t/s1.jsonl");
    t = applyHook(t, hook("UserPromptSubmit", { prompt: "fix the bug" }), 2);
    expect(t.state).toBe(STATES.running);
    expect(t.lastPrompt).toBe("fix the bug");
    t = applyHook(t, hook("PreToolUse", { tool_name: "Bash" }), 3);
    expect(t.currentTool).toBe("Bash");
    t = applyHook(t, hook("PermissionRequest", { tool_name: "Edit" }), 4);
    expect(t.state).toBe(STATES.awaitingApproval);
    expect(t.since).toBe(4);
    t = applyHook(t, hook("Stop"), 5);
    expect(t.state).toBe(STATES.idle);
    expect(t.currentTool).toBeNull();
    t = applyHook(t, hook("UserPromptSubmit", { prompt: "now the tests" }), 6);
    expect(t.firstPrompt).toBe("fix the bug");
    expect(t.lastPrompt).toBe("now the tests");
  });

  it("keeps `since` while the state is unchanged", () => {
    let t = applyHook(initialTelemetry(0), hook("UserPromptSubmit"), 10);
    t = applyHook(t, hook("PreToolUse", { tool_name: "Read" }), 20);
    t = applyHook(t, hook("PostToolUse", { tool_name: "Read" }), 30);
    expect(t.state).toBe(STATES.running);
    expect(t.since).toBe(10);
  });

  it("returns to the pre-compaction state after PostCompact", () => {
    let t = applyHook(initialTelemetry(0), hook("UserPromptSubmit"), 1);
    t = applyHook(t, hook("PreCompact"), 2);
    expect(t.state).toBe(STATES.compacting);
    t = applyHook(t, hook("PostCompact"), 3);
    expect(t.state).toBe(STATES.running);
    expect(t.stateBeforeCompact).toBeNull();
  });

  it("maps StopFailure to failed and SessionEnd to exited", () => {
    expect(applyHook(initialTelemetry(0), hook("StopFailure")).state).toBe(STATES.failed);
    expect(applyHook(initialTelemetry(0), hook("SessionEnd")).state).toBe(STATES.exited);
  });

  it("ignores unknown events but still records identity", () => {
    const t = applyHook(initialTelemetry(0), hook("SubagentStop"));
    expect(t.state).toBe(STATES.launching);
    expect(t.claudeSessionId).toBe("s1");
  });
});

describe("applyStatus", () => {
  const status = (extra) => ({
    session_id: "s1",
    model: { id: "claude-opus-5-5", display_name: "Opus" },
    cost: { total_cost_usd: 0.25 },
    context_window: { used_percentage: 12 },
    rate_limits: { five_hour: { used_percentage: 5 } },
    ...extra,
  });

  it("copies cost, context, model and rate limits", () => {
    const t = applyStatus(initialTelemetry(0), status());
    expect(t.totalCostUsd).toBe(0.25);
    expect(t.contextPct).toBe(12);
    expect(t.model).toEqual({ id: "claude-opus-5-5", name: "Opus" });
    expect(t.rateLimits.five_hour.used_percentage).toBe(5);
  });

  it("banks the previous session's cost when /clear changes the id", () => {
    let t = applyStatus(initialTelemetry(0), status({ cost: { total_cost_usd: 1.5 } }));
    t = applyStatus(t, status({ session_id: "s2", cost: { total_cost_usd: 0.1 } }));
    expect(t.claudeSessionId).toBe("s2");
    expect(t.bankedCostUsd).toBe(1.5);
    expect(t.totalCostUsd).toBeCloseTo(1.6);
  });

  it("keeps earlier values when a field is absent", () => {
    let t = applyStatus(initialTelemetry(0), status());
    t = applyStatus(t, { session_id: "s1" });
    expect(t.totalCostUsd).toBe(0.25);
    expect(t.contextPct).toBe(12);
  });
});

describe("applyExit", () => {
  it("maps exit codes to exited or failed", () => {
    expect(applyExit(initialTelemetry(0), 0).state).toBe(STATES.exited);
    expect(applyExit(initialTelemetry(0), 1).state).toBe(STATES.failed);
  });
});

describe("applyStatus remote control", () => {
  it("tracks the Remote Control connection reported by the relay", () => {
    const connected = applyStatus(initialTelemetry(0), { session_id: "s1" }, { remoteControlId: "rc-1" });
    expect(connected.remoteControlId).toBe("rc-1");
    expect(applyStatus(connected, { session_id: "s1" }).remoteControlId).toBeNull();
  });
});

describe("attentionFor", () => {
  it("flags approval requests and finished turns only", () => {
    expect(attentionFor(STATES.running, STATES.awaitingApproval)).toBe("approval");
    expect(attentionFor(STATES.running, STATES.idle)).toBe("finished");
    expect(attentionFor(STATES.compacting, STATES.idle)).toBe("finished");
    expect(attentionFor(STATES.launching, STATES.idle)).toBeNull();
    expect(attentionFor(STATES.idle, STATES.running)).toBeNull();
    expect(attentionFor(STATES.idle, STATES.idle)).toBeNull();
  });
});
