import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/renderer/bridge/CommandPalette.jsx";

const emptyState = {
  sessions: [],
  dormant: [],
  external: [],
  profiles: [],
  order: [],
  settings: { layout: { sort: "manual" } },
  canUndoTile: false,
};

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
    const items = buildIndex(state).filter((item) => item.kind !== "Tile");
    expect(items.map((item) => item.kind)).toEqual(["Session", "Prompt"]);
    expect(items[0].text).toContain("fix the build");
  });

  it("copes with a session whose activity has not arrived", () => {
    const session = { ...liveSession([]), activity: undefined };
    expect(buildIndex({ ...emptyState, sessions: [session] }).filter((item) => item.kind === "Session")).toHaveLength(
      1,
    );
  });

  it("offers tiling only while windows are live, and undo only after a tile", () => {
    const tiles = (state) => buildIndex(state).filter((item) => item.kind === "Tile");
    expect(tiles(emptyState)).toHaveLength(0);
    const live = { ...emptyState, sessions: [liveSession([])] };
    expect(tiles(live).map((item) => item.key)).toEqual(["tile:grid", "tile:columns", "tile:rows", "tile:main"]);
    expect(tiles({ ...live, canUndoTile: true }).at(-1).key).toBe("tile:undo");
  });
});
