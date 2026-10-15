import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

// Where profiles, settings, cards and history live. By default the user-data
// folder; a pointer file there can send them to a folder a sync tool
// (OneDrive, Syncthing) carries between machines. Per-session launch files
// stay local: they hold loopback URLs that mean nothing to another process.

export const DATA_FILES = Object.freeze(["profiles.json", "settings.json", "state.json", "history.jsonl"]);
const POINTER = "data-folder.json";

export function readPointer(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed?.path === "string" && parsed.path ? parsed.path : null;
  } catch {
    return null;
  }
}

// A pointer to a folder that is gone (an unmounted drive) falls back to the
// default rather than starting from nothing on a stray path.
export function resolveDataDir({ pointer, defaultDir, exists }) {
  return pointer && exists(pointer) ? pointer : defaultDir;
}

// Copy this machine's data into a folder that has none yet. A folder that
// already holds data wins: that is the point of pointing at one.
export function seedDataDir(from, to, { exists = existsSync, copy = copyFileSync } = {}) {
  if (path.resolve(from) === path.resolve(to)) return false;
  if (DATA_FILES.some((name) => exists(path.join(to, name)))) return false;
  let copied = false;
  for (const name of DATA_FILES) {
    const source = path.join(from, name);
    if (!exists(source)) continue;
    copy(source, path.join(to, name));
    copied = true;
  }
  return copied;
}

export function createDataDir() {
  const defaultDir = app.getPath("userData");
  const pointerFile = path.join(defaultDir, POINTER);
  const dir = resolveDataDir({ pointer: readPointer(pointerFile), defaultDir, exists: existsSync });
  mkdirSync(dir, { recursive: true });

  // Takes effect on the next start; the caller relaunches.
  function set(next) {
    if (!next || path.resolve(next) === path.resolve(defaultDir)) {
      try {
        unlinkSync(pointerFile);
      } catch {
        // Already on the default.
      }
      return defaultDir;
    }
    mkdirSync(next, { recursive: true });
    seedDataDir(dir, next);
    writeFileSync(pointerFile, JSON.stringify({ path: next }, null, 2));
    return next;
  }

  return { dir, defaultDir, isDefault: path.resolve(dir) === path.resolve(defaultDir), set };
}
