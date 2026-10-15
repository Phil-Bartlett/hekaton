import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DATA_FILES, resolveDataDir, seedDataDir } from "../src/main/dataDir.js";

describe("resolveDataDir", () => {
  it("uses the pointer only while its folder exists", () => {
    const exists = (p) => p === "/sync/hekaton";
    expect(resolveDataDir({ pointer: "/sync/hekaton", defaultDir: "/home/me/.config/hekaton", exists })).toBe(
      "/sync/hekaton",
    );
    expect(resolveDataDir({ pointer: "/gone", defaultDir: "/d", exists })).toBe("/d");
    expect(resolveDataDir({ pointer: null, defaultDir: "/d", exists })).toBe("/d");
  });
});

describe("seedDataDir", () => {
  it("copies the data files into an empty folder", () => {
    const have = new Set([path.join("/old", "profiles.json"), path.join("/old", "state.json")]);
    const copy = vi.fn();
    expect(seedDataDir("/old", "/new", { exists: (p) => have.has(p), copy })).toBe(true);
    expect(copy.mock.calls.map(([from, to]) => [path.basename(from), path.basename(to)])).toEqual([
      ["profiles.json", "profiles.json"],
      ["state.json", "state.json"],
    ]);
  });

  it("leaves a folder that already holds data alone", () => {
    const copy = vi.fn();
    const exists = (p) => p === path.join("/new", "settings.json") || p.startsWith("/old");
    expect(seedDataDir("/old", "/new", { exists, copy })).toBe(false);
    expect(copy).not.toHaveBeenCalled();
  });

  it("does nothing when old and new are the same folder", () => {
    const copy = vi.fn();
    expect(seedDataDir("/same", "/same", { exists: () => true, copy })).toBe(false);
    expect(copy).not.toHaveBeenCalled();
  });

  it("knows the four data files", () => {
    expect(DATA_FILES).toEqual(["profiles.json", "settings.json", "state.json", "history.jsonl"]);
  });
});
