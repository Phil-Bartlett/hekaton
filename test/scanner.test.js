import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter, scanReference } from "../src/main/scanner.js";

describe("parseFrontmatter", () => {
  it("reads pairs, quoted values, folded continuations and list items", () => {
    const text = [
      "---",
      "name: deploy",
      'description: "Deploy and verify"',
      "argument-hint: [dev|prod]",
      "allowed-tools: Bash(ssh *)",
      "  Bash(curl *)",
      "tools:",
      "  - Read",
      "  - Grep",
      "disable-model-invocation: true",
      "---",
      "",
      "Body starts here.",
    ].join("\n");
    const { data, body } = parseFrontmatter(text);
    expect(data).toEqual({
      name: "deploy",
      description: "Deploy and verify",
      "argument-hint": "[dev|prod]",
      "allowed-tools": "Bash(ssh *) Bash(curl *)",
      tools: "Read, Grep",
      "disable-model-invocation": "true",
    });
    expect(body).toBe("Body starts here.");
  });

  it("treats a file without frontmatter as all body", () => {
    expect(parseFrontmatter("# Just text")).toEqual({ data: {}, body: "# Just text" });
  });
});

describe("scanReference", () => {
  let home;
  let project;
  let custom;

  const write = (file, text) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "hekaton-home-"));
    project = mkdtempSync(path.join(os.tmpdir(), "hekaton-proj-"));
    custom = mkdtempSync(path.join(os.tmpdir(), "hekaton-custom-"));
    write(
      path.join(home, "skills", "plaud-read", "SKILL.md"),
      "---\nname: plaud-read\ndescription: Read a recording\n---\nRead it.",
    );
    write(
      path.join(home, "agents", "helper.md"),
      "---\nname: helper\ndescription: Helps\nmodel: haiku\ntools: Read, Grep\n---\nYou help.",
    );
    write(path.join(home, "commands", "quick.md"), "No frontmatter here.");
    write(path.join(home, "commands", "git", "sync.md"), "---\ndescription: Sync\n---\nSync it.");
    write(
      path.join(home, "plugins", "cache", "official", "diff", "1.0.0", "skills", "diff", "SKILL.md"),
      "---\ndescription: Diff\n---\n",
    );
    write(
      path.join(project, ".claude", "skills", "ship", "SKILL.md"),
      "---\nname: ship\ndescription: Ship it\ndisable-model-invocation: true\n---\n",
    );
    write(path.join(custom, "agents", "extra.md"), "---\ndescription: Extra\n---\n");
  });

  afterEach(() => {
    for (const dir of [home, project, custom]) rmSync(dir, { recursive: true, force: true });
  });

  it("collects skills, agents and commands from every root with their source", () => {
    const entries = scanReference({ home, projectDirs: [project, project], customRoots: [custom] });
    const summary = entries.map((e) => `${e.kind}:${e.name}@${e.source}`);
    expect(summary).toEqual([
      `agent:extra@Custom ${path.basename(custom)}`,
      "agent:helper@User",
      "command:git:sync@User",
      "command:quick@User",
      "skill:diff@Plugin diff",
      "skill:plaud-read@User",
      `skill:ship@Project ${path.basename(project)}`,
    ]);
    const helper = entries.find((e) => e.name === "helper");
    expect(helper).toMatchObject({ model: "haiku", tools: "Read, Grep", invocation: null, preview: "You help." });
    expect(entries.find((e) => e.name === "git:sync").invocation).toBe("/git:sync");
    expect(entries.find((e) => e.name === "ship").modelInvocable).toBe(false);
    expect(entries.find((e) => e.name === "quick").description).toBe("");
  });

  it("returns an empty list when nothing exists", () => {
    expect(scanReference({ home: path.join(home, "missing") })).toEqual([]);
  });
});
