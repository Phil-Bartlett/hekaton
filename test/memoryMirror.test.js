import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMirror, memoryFiles, syncMirror } from "../src/main/memoryMirror.js";
import { scanReference } from "../src/main/scanner.js";

let dir;
let home;
let out;

function write(file, text, mtime) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (mtime) utimesSync(file, mtime, mtime);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hekaton-mirror-"));
  home = path.join(dir, "home");
  out = path.join(dir, "out");
  const old = new Date("2026-01-01T00:00:00Z");
  write(path.join(home, "CLAUDE.md"), "# rules", old);
  write(path.join(home, "projects", "C--proj", "memory", "MEMORY.md"), "- [x](x.md) — hook", old);
  write(
    path.join(home, "projects", "C--proj", "memory", "x.md"),
    "---\nname: x\ndescription: a trap\n---\n\nThe fact.",
    old,
  );
  write(path.join(home, "projects", "C--proj", "memory", "notes.txt"), "not markdown", old);
  write(path.join(home, "projects", "C--proj", "other.md"), "not memory", old);
  write(path.join(home, "settings.json"), "{}", old);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("memoryFiles", () => {
  it("lists CLAUDE.md and every project's memory notes, nothing else", () => {
    expect(memoryFiles(home).sort()).toEqual([
      "CLAUDE.md",
      path.join("projects", "C--proj", "memory", "MEMORY.md"),
      path.join("projects", "C--proj", "memory", "x.md"),
    ]);
    expect(memoryFiles(path.join(dir, "nowhere"))).toEqual([]);
  });
});

describe("syncMirror", () => {
  it("copies the files once, then only what changed, and removes what went", () => {
    expect(syncMirror(home, out)).toEqual({ copied: 3, removed: 0, total: 3 });
    expect(readFileSync(path.join(out, "projects", "C--proj", "memory", "x.md"), "utf8")).toContain("The fact.");
    expect(existsSync(path.join(out, "projects", "C--proj", "memory", "notes.txt"))).toBe(false);
    expect(syncMirror(home, out)).toEqual({ copied: 0, removed: 0, total: 3 });

    write(path.join(home, "projects", "C--proj", "memory", "x.md"), "---\nname: x\n---\n\nChanged.", new Date());
    rmSync(path.join(home, "CLAUDE.md"));
    expect(syncMirror(home, out)).toEqual({ copied: 1, removed: 1, total: 2 });
    expect(readFileSync(path.join(out, "projects", "C--proj", "memory", "x.md"), "utf8")).toContain("Changed.");
    expect(existsSync(path.join(out, "CLAUDE.md"))).toBe(false);

    clearMirror(out);
    expect(existsSync(out)).toBe(false);
    clearMirror(out);
  });
});

describe("scanReference memory roots", () => {
  it("lists this machine's notes and each mirror under its machine", () => {
    syncMirror(home, out);
    const entries = scanReference({
      home: path.join(dir, "empty-home"),
      memory: [
        { dir: home, source: "helix (here)" },
        { dir: out, source: "laptop" },
      ],
    }).filter((entry) => entry.kind === "memory");
    expect(entries.map((entry) => [entry.source, entry.project, entry.name])).toEqual([
      ["helix (here)", null, "CLAUDE.md"],
      ["helix (here)", "C--proj", "MEMORY.md"],
      ["helix (here)", "C--proj", "x"],
      ["laptop", null, "CLAUDE.md"],
      ["laptop", "C--proj", "MEMORY.md"],
      ["laptop", "C--proj", "x"],
    ]);
    const trap = entries.find((entry) => entry.source === "laptop" && entry.name === "x");
    expect(trap).toMatchObject({
      description: "a trap",
      file: path.join(out, "projects", "C--proj", "memory", "x.md"),
    });
    expect(trap.preview).toContain("The fact.");
    expect(trap.modifiedAt).toBeGreaterThan(0);
  });
});
