import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Write-then-rename so a crash mid-write never leaves a truncated file.
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

// Launch profiles, persisted as one JSON file in the app's user-data folder.
export function createStore() {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  const profilesFile = path.join(dir, "profiles.json");
  let profiles = readJson(profilesFile, []);

  function saveProfile(profile) {
    const name = String(profile.name ?? "").trim();
    if (!name || !profile.cwd) throw new Error("A profile needs a name and a working directory");
    const next = { ...profile, name, id: profile.id ?? randomUUID() };
    const index = profiles.findIndex((p) => p.id === next.id);
    profiles = index === -1 ? [...profiles, next] : profiles.map((p) => (p.id === next.id ? next : p));
    writeJson(profilesFile, profiles);
    return next;
  }

  function deleteProfile(id) {
    profiles = profiles.filter((p) => p.id !== id);
    writeJson(profilesFile, profiles);
  }

  function findProfile(idOrName) {
    return profiles.find((p) => p.id === idOrName || p.name === idOrName) ?? null;
  }

  return { profiles: () => profiles, saveProfile, deleteProfile, findProfile };
}
