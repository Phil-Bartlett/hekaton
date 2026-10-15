import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
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
    transcriptPath: telemetry.transcriptPath ?? null,
    title: telemetry.sessionName ?? null,
    model: telemetry.model?.name ?? null,
    firstPrompt: telemetry.firstPrompt,
    lastPrompt: telemetry.lastPrompt,
    totalCostUsd: telemetry.totalCostUsd,
    startedAt: session.startedAt,
    lastSeenAt: Date.now(),
    exitCode: session.exitCode,
    // The data folder may be shared between machines; a conversation resumes only where it was recorded.
    host: os.hostname(),
    bounds,
    pinned,
    trayOpen,
  };
}

function readState(file) {
  const empty = { bridge: null, instances: [], order: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.instances)) return empty;
    return { bridge: parsed.bridge ?? null, instances: parsed.instances, order: parsed.order ?? [] };
  } catch {
    return empty;
  }
}

export function createInstances({ file }) {
  mkdirSync(path.dirname(file), { recursive: true });
  const loaded = readState(file);
  // Nothing is running when the store is created, so every saved entry is dormant.
  const entries = new Map(loaded.instances.filter((e) => e?.id).map((e) => [e.id, { ...e, live: false }]));
  let bridge = loaded.bridge;
  // Manual card order on the Bridge; ids not listed sort after the listed ones.
  let order = loaded.order.filter((id) => entries.has(id));
  let timer = null;

  function saveNow() {
    clearTimeout(timer);
    timer = null;
    const tmp = `${file}.tmp`;
    const state = { version: STATE_VERSION, bridge, order, instances: [...entries.values()] };
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, file);
  }

  function save() {
    if (timer) return;
    timer = setTimeout(saveNow, SAVE_DELAY_MS);
  }

  // A resumed session starts with empty telemetry; what the card already
  // knew (prompts, title, model, transcript) stays until real values arrive.
  function record(summary) {
    const previous = entries.get(summary.id) ?? {};
    const merged = { ...previous, ...summary, live: true };
    for (const key of ["firstPrompt", "lastPrompt", "title", "model", "transcriptPath", "bounds"]) {
      if (merged[key] === null || merged[key] === undefined) merged[key] = previous[key] ?? null;
    }
    if (!summary.totalCostUsd && previous.totalCostUsd) merged.totalCostUsd = previous.totalCostUsd;
    entries.set(summary.id, merged);
    save();
  }

  // A card for a conversation Hekaton never ran: starts dormant.
  function addDormant(entry) {
    entries.set(entry.id, { ...entry, live: false, lastSeenAt: entry.lastSeenAt ?? Date.now() });
    save();
    return entries.get(entry.id);
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
    if (removed) {
      order = order.filter((other) => other !== id);
      save();
    }
    return removed;
  }

  // Re-home a card under another profile. The conversation keeps its
  // transcript; a later resume uses the transcript path, so the new folder
  // does not have to be where it was recorded.
  function move(id, profile) {
    const entry = entries.get(id);
    if (!entry || !profile) return null;
    const moved = {
      ...entry,
      profileId: profile.id ?? null,
      profileName: profile.name,
      accent: profile.accent ?? null,
      colorScope: profile.colorScope ?? entry.colorScope,
      cwd: profile.cwd,
      // Where the conversation was recorded; a resume from elsewhere goes by transcript path.
      recordedCwd: entry.recordedCwd ?? entry.cwd,
    };
    entries.set(id, moved);
    save();
    return moved;
  }

  function setOrder(ids) {
    order = ids.filter((id, index) => entries.has(id) && ids.indexOf(id) === index);
    save();
  }

  function setBridgeBounds(next) {
    bridge = next;
    save();
  }

  return {
    record,
    addDormant,
    markDormant,
    dismiss,
    move,
    setOrder,
    order: () => [...order],
    get: (id) => entries.get(id) ?? null,
    list: () => [...entries.values()],
    dormant: () => [...entries.values()].filter((entry) => !entry.live),
    bridgeBounds: () => bridge,
    setBridgeBounds,
    saveNow,
  };
}
