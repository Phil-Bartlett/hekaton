import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/renderer/bridge/CommandPalette.jsx";

const emptyState = { sessions: [], dormant: [], external: [], profiles: [] };

function liveSession(turns) {
  return {
    id: "s1",
    profile: { name: "Argus", cwd: "C:/argus" },
    telemetry: { lastPrompt: null },
    activity: { turns, totalCostUsd: 0, unpriced: false, droppedTurns: 0, links: [], title: null },
  };
}

describe("buildIndex", () => {
  it("indexes a live session's prompts from its activity turns", () => {
    const state = { ...emptyState, sessions: [liveSession([{ prompt: "fix the build" }])] };
    const items = buildIndex(state);
    expect(items.map((item) => item.kind)).toEqual(["Session", "Prompt"]);
    expect(items[0].text).toContain("fix the build");
  });

  it("copes with a session whose activity has not arrived", () => {
    const session = { ...liveSession([]), activity: undefined };
    expect(buildIndex({ ...emptyState, sessions: [session] })).toHaveLength(1);
  });
});
