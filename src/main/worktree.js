import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

// A profile can launch in a fresh git worktree so parallel sessions edit
// their own checkout and branch instead of fighting over one. The worktree
// is left in place when the session ends; removing it (and any uncommitted
// work in it) stays the user's decision.

export function slugify(value) {
  const slug = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || "session";
}

// Where the new worktree and branch go, given the repository's top level.
// A sibling "<repo>-worktrees" folder keeps them next to the repo but outside
// its working tree, which git requires.
export function worktreePlan({ repoRoot, profileName, id }) {
  const leaf = `${slugify(profileName)}-${id.slice(0, 6)}`;
  const parent = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-worktrees`);
  return { branch: `hekaton/${leaf}`, dir: path.join(parent, leaf) };
}

export function worktreeAddArgs(repoRoot, dir, branch) {
  return ["-C", repoRoot, "worktree", "add", "-b", branch, dir, "HEAD"];
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Create a worktree for a launch, returning the directory to run in. On any
// failure (not a repo, git missing, branch clash) the original directory is
// returned with the reason, so a launch never blocks on worktree trouble.
export function ensureWorktree(cwd, { profileName, id }) {
  let repoRoot;
  try {
    repoRoot = git(["-C", cwd, "rev-parse", "--show-toplevel"]);
  } catch {
    return { dir: cwd, created: false, error: "Not a git repository" };
  }
  const { branch, dir } = worktreePlan({ repoRoot, profileName, id });
  try {
    mkdirSync(path.dirname(dir), { recursive: true });
    git(worktreeAddArgs(repoRoot, dir, branch));
    return { dir, branch, created: true };
  } catch (error) {
    return { dir: cwd, created: false, error: error.stderr?.toString().trim() || error.message };
  }
}
