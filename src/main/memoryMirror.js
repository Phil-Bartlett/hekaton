import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import path from "node:path";

// Claude Code keeps the user's CLAUDE.md and each project's memory notes
// under ~/.claude. A machine can copy those into its host folder so the
// other machines can read them in the reference browser. One way only:
// the copies are never written back, and ~/.claude is never written.

export const MIRROR_DIR = "claude";
export const MIRROR_INTERVAL_MS = 5 * 60_000;
// Sync tools and FAT-style filesystems round modification times.
const SAME_TIME_MS = 2000;

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function statOrNull(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

// Everything that is mirrored, relative to ~/.claude, in the same shape
// there and in the mirror: CLAUDE.md and projects/<slug>/memory/*.md.
export function memoryFiles(home) {
  const files = [];
  if (statOrNull(path.join(home, "CLAUDE.md"))?.isFile()) files.push("CLAUDE.md");
  for (const project of listDir(path.join(home, "projects"))) {
    if (!project.isDirectory()) continue;
    const memory = path.join("projects", project.name, "memory");
    for (const entry of listDir(path.join(home, memory))) {
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(path.join(memory, entry.name));
    }
  }
  return files;
}

function markdownBelow(dir, base = dir, into = []) {
  for (const entry of listDir(dir)) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownBelow(file, base, into);
    else if (entry.isFile() && entry.name.endsWith(".md")) into.push(path.relative(base, file));
  }
  return into;
}

// Makes `out` hold exactly the mirrored files: copies what is new or
// changed (by size and modification time) and removes what has gone.
export function syncMirror(home, out) {
  const wanted = memoryFiles(home);
  const stale = new Set(markdownBelow(out));
  let copied = 0;
  for (const rel of wanted) {
    stale.delete(rel);
    const source = path.join(home, rel);
    const target = path.join(out, rel);
    const from = statSync(source);
    const to = statOrNull(target);
    if (to && to.size === from.size && Math.abs(to.mtimeMs - from.mtimeMs) < SAME_TIME_MS) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    utimesSync(target, from.atime, from.mtime);
    copied += 1;
  }
  for (const rel of stale) rmSync(path.join(out, rel), { force: true });
  return { copied, removed: stale.size, total: wanted.length };
}

export function clearMirror(out) {
  rmSync(out, { recursive: true, force: true });
}
