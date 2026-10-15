import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInstances, summarise } from "../src/main/instances.js";

const session = {
  id: "inst-1",
  sessionId: "launch-uuid",
  startedAt: 100,
  exitCode: null,
  profile: { id: "p1", name: "Frontend", accent: "#ff0000", cwd: "C:/proj" },
  telemetry: {
    claudeSessionId: "claude-uuid",
    model: { name: "Opus" },
    firstPrompt: "first",
    lastPrompt: "last",
    totalCostUsd: 1.25,
  },
};

describe("summarise", () => {
  it("keeps what a dormant card and a resume need", () => {
    const summary = summarise(session, { bounds: { x: 1, y: 2, width: 3, height: 4 }, pinned: true, trayOpen: true });
    expect(summary).toMatchObject({
      id: "inst-1",
      profileId: "p1",
      profileName: "Frontend",
      accent: "#ff0000",
      cwd: "C:/proj",
      claudeSessionId: "claude-uuid",
      model: "Opus",
      firstPrompt: "first",
      lastPrompt: "last",
      totalCostUsd: 1.25,
      startedAt: 100,
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      pinned: true,
      trayOpen: true,
    });
  });

  it("falls back to the launch session id before the first hook arrives", () => {
    const fresh = { ...session, telemetry: { ...session.telemetry, claudeSessionId: null } };
    expect(summarise(fresh).claudeSessionId).toBe("launch-uuid");
  });
});

describe("createInstances", () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "hekaton-state-"));
    file = path.join(dir, "state.json");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("records live entries, marks them dormant, and reloads them dormant", () => {
    const store = createInstances({ file });
    store.record(summarise(session));
    expect(store.list()[0].live).toBe(true);
    store.markDormant("inst-1", { exitCode: 0 });
    store.setBridgeBounds({ x: 5, y: 6, width: 700, height: 500 });
    store.saveNow();

    const reloaded = createInstances({ file });
    expect(reloaded.dormant().map((e) => e.id)).toEqual(["inst-1"]);
    expect(reloaded.get("inst-1")).toMatchObject({ live: false, exitCode: 0, claudeSessionId: "claude-uuid" });
    expect(reloaded.bridgeBounds()).toEqual({ x: 5, y: 6, width: 700, height: 500 });
  });

  it("never lists a live entry as dormant after a restart, and refuses to dismiss a live one", () => {
    const store = createInstances({ file });
    store.record(summarise(session));
    store.saveNow();
    expect(createInstances({ file }).get("inst-1").live).toBe(false);
    expect(store.dismiss("inst-1")).toBe(false);
    store.markDormant("inst-1");
    expect(store.dismiss("inst-1")).toBe(true);
    store.saveNow();
    expect(JSON.parse(readFileSync(file, "utf8")).instances).toEqual([]);
  });

  it("keeps saved prompts, title and cost while a resumed session has none yet", () => {
    const store = createInstances({ file });
    store.record(summarise(session));
    store.markDormant("inst-1");
    const resumed = {
      ...session,
      telemetry: { claudeSessionId: null, model: null, firstPrompt: null, lastPrompt: null, totalCostUsd: 0 },
    };
    store.record(summarise(resumed));
    expect(store.get("inst-1")).toMatchObject({
      live: true,
      firstPrompt: "first",
      lastPrompt: "last",
      model: "Opus",
      totalCostUsd: 1.25,
      claudeSessionId: "launch-uuid",
    });
    store.record(
      summarise({ ...resumed, telemetry: { ...resumed.telemetry, lastPrompt: "newer", totalCostUsd: 0.5 } }),
    );
    expect(store.get("inst-1")).toMatchObject({ lastPrompt: "newer", totalCostUsd: 0.5 });
  });

  it("ignores an unreadable or foreign state file", () => {
    rmSync(dir, { recursive: true, force: true });
    expect(createInstances({ file }).list()).toEqual([]);
  });
});
