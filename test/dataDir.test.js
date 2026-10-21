import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DATA_FILES, dataFiles, resolveDataDir, seedDataDir } from "../src/main/dataDir.js";

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
    const mkdir = vi.fn();
    expect(seedDataDir("/old", "/new", { exists: (p) => have.has(p), copy, mkdir })).toBe(true);
    expect(copy.mock.calls.map(([from, to]) => [path.basename(from), path.basename(to)])).toEqual([
      ["profiles.json", "profiles.json"],
      ["state.json", "state.json"],
    ]);
  });

  it("carries this machine's host folder along with the shared files", () => {
    const hostState = path.join("hosts", "dev-1", "state.json");
    const have = new Set([path.join("/old", "settings.json"), path.join("/old", hostState)]);
    const copy = vi.fn();
    const mkdir = vi.fn();
    expect(seedDataDir("/old", "/new", { deviceId: "dev-1", exists: (p) => have.has(p), copy, mkdir })).toBe(true);
    expect(copy.mock.calls).toEqual([
      [path.join("/old", "settings.json"), path.join("/new", "settings.json")],
      [path.join("/old", hostState), path.join("/new", hostState)],
    ]);
    expect(mkdir).toHaveBeenCalledWith(path.join("/new", "hosts", "dev-1"), { recursive: true });
  });

  it("leaves a folder that already holds data alone", () => {
    const copy = vi.fn();
    const mkdir = vi.fn();
    const exists = (p) => p === path.join("/new", "settings.json") || p.startsWith("/old");
    expect(seedDataDir("/old", "/new", { exists, copy, mkdir })).toBe(false);
    expect(copy).not.toHaveBeenCalled();
    const hostOnly = (p) => p === path.join("/new", "hosts", "dev-1", "state.json") || p.startsWith("/old");
    expect(seedDataDir("/old", "/new", { deviceId: "dev-1", exists: hostOnly, copy, mkdir })).toBe(false);
    expect(copy).not.toHaveBeenCalled();
  });

  it("does nothing when old and new are the same folder", () => {
    const copy = vi.fn();
    expect(seedDataDir("/same", "/same", { exists: () => true, copy, mkdir: vi.fn() })).toBe(false);
    expect(copy).not.toHaveBeenCalled();
  });

  it("knows the four shared data files and the host state file", () => {
    expect(DATA_FILES).toEqual(["profiles.json", "settings.json", "state.json", "history.jsonl"]);
    expect(dataFiles(null)).toEqual([...DATA_FILES]);
    expect(dataFiles("dev-1")).toEqual([...DATA_FILES, path.join("hosts", "dev-1", "state.json")]);
  });
});
