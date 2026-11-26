import { describe, expect, it } from "vitest";
import { busyReason, CLOSE_CHOICES, closePrompt, quitPrompt, sessionLabel } from "../src/main/closeGuard.js";

const session = (telemetry, extra = {}) => ({
  exitCode: null,
  profile: { name: "Argus" },
  telemetry: { state: "idle", currentTool: null, sessionName: null, ...telemetry },
  ...extra,
});

describe("busyReason", () => {
  it("is null for a session with nothing in flight", () => {
    expect(busyReason(session({ state: "idle" }))).toBeNull();
    expect(busyReason(session({ state: "launching" }))).toBeNull();
    expect(busyReason(session({ state: "failed" }))).toBeNull();
  });

  it("says what a working session is doing", () => {
    expect(busyReason(session({ state: "running" }))).toBe("thinking");
    expect(busyReason(session({ state: "running", currentTool: "Bash" }))).toBe("running Bash");
    expect(busyReason(session({ state: "awaiting_approval", currentTool: "Edit" }))).toBe("waiting for an approval");
    expect(busyReason(session({ state: "compacting" }))).toBe("compacting its conversation");
  });

  it("is null once Claude has exited, whatever the last state was", () => {
    expect(busyReason(session({ state: "running" }, { exitCode: 0 }))).toBeNull();
  });
});

describe("sessionLabel", () => {
  it("adds Claude's name for the conversation when it differs from the profile", () => {
    expect(sessionLabel(session({}))).toBe("Argus");
    expect(sessionLabel(session({ sessionName: "Argus" }))).toBe("Argus");
    expect(sessionLabel(session({ sessionName: "Host updates" }))).toBe("Argus · Host updates");
  });
});

describe("prompts", () => {
  it("names the window and defaults to keeping it open", () => {
    const prompt = closePrompt(session({ state: "running", currentTool: "Bash", sessionName: "Host updates" }));
    expect(prompt.message).toBe("Argus · Host updates is still running Bash.");
    expect(prompt.buttons[prompt.defaultId]).toBe("Keep open");
    expect(prompt.cancelId).toBe(CLOSE_CHOICES.keep);
    expect(prompt.buttons[CLOSE_CHOICES.whenFinished]).toBe("Close when finished");
    expect(prompt.buttons[CLOSE_CHOICES.now]).toBe("Close now");
  });

  it("lists every working session when quitting and defaults to cancel", () => {
    const one = quitPrompt([session({ state: "running" })]);
    expect(one.message).toBe("A session is still working.");
    const two = quitPrompt([
      session({ state: "running" }),
      { ...session({ state: "compacting" }), profile: { name: "Hekaton" } },
    ]);
    expect(two.message).toBe("2 sessions are still working.");
    expect(two.detail).toContain("Argus is thinking\nHekaton is compacting its conversation");
    expect(two.buttons[two.defaultId]).toBe("Cancel");
    expect(two.buttons[CLOSE_CHOICES.now]).toBe("Quit now");
  });
});
