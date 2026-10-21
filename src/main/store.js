import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./jsonFile.js";
import { DEFAULT_GAP } from "./tiling.js";

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export const DEFAULT_SETTINGS = Object.freeze({
  referenceRoots: [],
  statusAppearance: {},
  terminal: { fontFamily: "", fontSize: 14 },
  hotkey: "",
  theme: "dark",
  customThemes: {},
  claudeBinary: "",
  showSessionNames: true,
  layout: { sort: "manual", density: "comfortable" },
  tiling: { layout: "grid", gap: DEFAULT_GAP },
  layouts: [],
  notifyApproval: true,
  notifyFinished: true,
  keepInTray: true,
  launchAtLogin: false,
  autoUpdate: true,
  // Off until asked: memory notes go into the shared folder only on purpose.
  shareMemory: false,
});

// Launch profiles and app settings, each one JSON file in the data folder.
export function createStore({ dir }) {
  mkdirSync(dir, { recursive: true });
  const profilesFile = path.join(dir, "profiles.json");
  const settingsFile = path.join(dir, "settings.json");
  let profiles = readJson(profilesFile, []);
  let settings = { ...DEFAULT_SETTINGS, ...readJson(settingsFile, {}) };

  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    writeJsonAtomic(settingsFile, settings);
    return settings;
  }

  function saveProfile(profile) {
    const name = String(profile.name ?? "").trim();
    if (!name || !profile.cwd) throw new Error("A profile needs a name and a working directory");
    const next = { ...profile, name, id: profile.id ?? randomUUID() };
    const index = profiles.findIndex((p) => p.id === next.id);
    profiles = index === -1 ? [...profiles, next] : profiles.map((p) => (p.id === next.id ? next : p));
    writeJsonAtomic(profilesFile, profiles);
    return next;
  }

  function deleteProfile(id) {
    profiles = profiles.filter((p) => p.id !== id);
    writeJsonAtomic(profilesFile, profiles);
  }

  function findProfile(idOrName) {
    return profiles.find((p) => p.id === idOrName || p.name === idOrName) ?? null;
  }

  return { profiles: () => profiles, saveProfile, deleteProfile, findProfile, settings: () => settings, saveSettings };
}
