import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Every session the Bridge has shown, running or not, so a relaunch of the
// app brings the same cards back. A dormant entry carries enough to resume
// the conversation (`claudeSessionId`) and to put its window back where it
// was. Persisted as state.json next to profiles.json.

const STATE_VERSION = 1;
const SAVE_DELAY_MS = 300;

export function summarise(session, { bounds = null, pinned = false, trayOpen = false } = {}) {
  const { profile, telemetry } = session;
  return {
    id: session.id,
    profileId: profile.id ?? null,
    profileName: profile.name,
    accent: profile.accent ?? null,
    colorScope: profile.colorScope ?? "border+title",
    cwd: profile.cwd,
    claudeSessionId: telemetry.claudeSessionId ?? session.sessionId ?? null,
    title: telemetry.sessionName ?? null,
    model: telemetry.model?.name ?? null,
    firstPrompt: telemetry.firstPrompt,
    lastPrompt: telemetry.lastPrompt,
    totalCostUsd: telemetry.totalCostUsd,
    startedAt: session.startedAt,
    lastSeenAt: Date.now(),
    exitCode: session.exitCode,
    bounds,
    pinned,
    trayOpen,
  };
}

function readState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.instances)) return { bridge: null, instances: [] };
    return { bridge: parsed.bridge ?? null, instances: parsed.instances };
  } catch {
    return { bridge: null, instances: [] };
  }
}

export function createInstances({ file }) {
  mkdirSync(path.dirname(file), { recursive: true });
  const loaded = readState(file);
  // Nothing is running when the store is created, so every saved entry is dormant.
  const entries = new Map(loaded.instances.filter((e) => e?.id).map((e) => [e.id, { ...e, live: false }]));
  let bridge = loaded.bridge;
  let timer = null;

  function saveNow() {
    clearTimeout(timer);
    timer = null;
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: STATE_VERSION, bridge, instances: [...entries.values()] }, null, 2));
    renameSync(tmp, file);
  }

  function save() {
    if (timer) return;
    timer = setTimeout(saveNow, SAVE_DELAY_MS);
  }

  function record(summary) {
    entries.set(summary.id, { ...entries.get(summary.id), ...summary, live: true });
    save();
  }

  function markDormant(id, patch = {}) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.set(id, { ...entry, ...patch, live: false, lastSeenAt: Date.now() });
    save();
  }

  function dismiss(id) {
    if (entries.get(id)?.live) return false;
    const removed = entries.delete(id);
    if (removed) save();
    return removed;
  }

  function setBridgeBounds(next) {
    bridge = next;
    save();
  }

  return {
    record,
    markDormant,
    dismiss,
    get: (id) => entries.get(id) ?? null,
    list: () => [...entries.values()],
    dormant: () => [...entries.values()].filter((entry) => !entry.live),
    bridgeBounds: () => bridge,
    setBridgeBounds,
    saveNow,
  };
}
