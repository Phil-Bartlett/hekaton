import path from "node:path";
import { describe, expect, it } from "vitest";
import { slugify, worktreeAddArgs, worktreePlan } from "../src/main/worktree.js";

describe("slugify", () => {
  it("lowercases, collapses punctuation and caps length", () => {
    expect(slugify("Frontend Work!")).toBe("frontend-work");
    expect(slugify("  --Mixed__Case--  ")).toBe("mixed-case");
    expect(slugify("")).toBe("session");
    expect(slugify("x".repeat(40))).toHaveLength(24);
  });
});

describe("worktreePlan", () => {
  it("branches under hekaton/ and places the worktree in a sibling folder", () => {
    const plan = worktreePlan({ repoRoot: "/home/me/projects/app", profileName: "API Work", id: "abcdef123456" });
    expect(plan.branch).toBe("hekaton/api-work-abcdef");
    expect(plan.dir).toBe(path.join("/home/me/projects", "app-worktrees", "api-work-abcdef"));
  });
});

describe("worktreeAddArgs", () => {
  it("adds a new branch at HEAD in the worktree directory", () => {
    expect(worktreeAddArgs("/repo", "/repo-worktrees/x", "hekaton/x")).toEqual([
      "-C",
      "/repo",
      "worktree",
      "add",
      "-b",
      "hekaton/x",
      "/repo-worktrees/x",
      "HEAD",
    ]);
  });
});
