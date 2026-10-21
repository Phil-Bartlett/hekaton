import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./jsonFile.js";

// Several Hekatons can share one data folder, one per machine. Each writes
// only under hosts/<deviceId>/: its own cards (state.json) and a presence
// file (host.json) carrying its live sessions and a heartbeat, so no two
// machines ever write the same file and a sync tool has nothing to merge.
// Every other machine's folder is read and shown, never written.

export const HOSTS_DIR = "hosts";
export const PRESENCE_FILE = "host.json";
export const STATE_FILE = "state.json";
export const DEVICE_FILE = "device.json";
export const HEARTBEAT_MS = 5000;
// Generous, because the presence file may arrive through OneDrive or Syncthing.
export const STALE_MS = 60_000;
const POLL_MS = 5000;
const PUBLISH_DELAY_MS = 1000;
const WATCH_DEBOUNCE_MS = 400;
const SCHEMA = 1;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// A machine's identity: a random id minted on first run and kept in the
// local user-data folder, never the shared one, so a renamed machine keeps
// its cards and two machines with the same hostname stay apart.
export function readDevice(file, { hostname = os.hostname(), uuid = randomUUID } = {}) {
  const parsed = readJson(file);
  if (typeof parsed?.id === "string" && parsed.id) {
    return { id: parsed.id, name: typeof parsed.name === "string" && parsed.name ? parsed.name : hostname };
  }
  const device = { id: uuid(), name: hostname };
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, device);
  return device;
}

export function hostDir(dataDir, deviceId) {
  return path.join(dataDir, HOSTS_DIR, deviceId);
}

// Before per-host files every machine wrote the one shared state.json, each
// overwriting the others' cards. The first run after the change takes this
// machine's cards out of it; the legacy file stays for machines still on the
// old version, which take their own cards out the same way when they update.
export function migrateLegacyState({ legacyFile, hostFile, hostname }) {
  if (existsSync(hostFile)) return 0;
  const parsed = readJson(legacyFile);
  if (parsed?.version !== 1 || !Array.isArray(parsed.instances)) return 0;
  const instances = parsed.instances.filter((entry) => entry?.id && (!entry.host || entry.host === hostname));
  const ids = new Set(instances.map((entry) => entry.id));
  mkdirSync(path.dirname(hostFile), { recursive: true });
  writeJsonAtomic(hostFile, {
    version: 1,
    bridge: parsed.bridge ?? null,
    order: (parsed.order ?? []).filter((id) => ids.has(id)),
    instances,
  });
  return instances.length;
}

// What another machine's Bridge draws for one of this machine's live sessions.
export function presenceSession(session) {
  const { profile, telemetry } = session;
  return {
    id: session.id,
    profileId: profile.id ?? null,
    profileName: profile.name,
    accent: profile.accent ?? null,
    cwd: profile.cwd,
    claudeSessionId: telemetry.claudeSessionId ?? session.sessionId ?? null,
    title: telemetry.sessionName ?? session.activity?.title ?? null,
    model: telemetry.model?.name ?? null,
    state: telemetry.state,
    since: telemetry.since,
    currentTool: telemetry.currentTool ?? null,
    lastPrompt: telemetry.lastPrompt ?? null,
    totalCostUsd: telemetry.totalCostUsd ?? 0,
    contextPct: telemetry.contextPct ?? null,
    remoteControlId: telemetry.remoteControlId ?? null,
    startedAt: session.startedAt,
    links: session.activity?.links ?? [],
  };
}

// One machine as seen from another. Its live sessions come from the presence
// file while the heartbeat is fresh; everything in its state file that is
// not among them is a saved card. A stale or stopped presence means nothing
// there is running, whatever its state file says.
export function readHost(dir, id, now = Date.now()) {
  const presence = readJson(path.join(dir, PRESENCE_FILE));
  const state = readJson(path.join(dir, STATE_FILE));
  if (!presence && !state) return null;
  const online = Boolean(presence) && !presence.stoppedAt && now - (presence.seenAt ?? 0) < STALE_MS;
  const sessions = online && Array.isArray(presence.sessions) ? presence.sessions.filter((s) => s?.id) : [];
  const live = new Set(sessions.map((s) => s.id));
  const instances = Array.isArray(state?.instances) ? state.instances.filter((e) => e?.id && !live.has(e.id)) : [];
  return {
    id,
    name: presence?.name ?? instances.find((entry) => entry.host)?.host ?? id,
    platform: presence?.platform ?? null,
    app: presence?.app ?? null,
    online,
    seenAt: presence?.seenAt ?? null,
    sessions,
    dormant: instances.map((entry) => ({ ...entry, live: false })),
  };
}

export function readHosts(dataDir, { exclude, now = Date.now() } = {}) {
  let entries;
  try {
    entries = readdirSync(path.join(dataDir, HOSTS_DIR), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== exclude)
    .map((entry) => readHost(path.join(dataDir, HOSTS_DIR, entry.name), entry.name, now))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// Publishes this machine's presence and follows every other machine's.
// `liveSessions()` is asked for the sessions whenever the presence is
// written; `onChange()` fires when another machine's view changes.
export function createFleet({ dataDir, device, appVersion, liveSessions, onChange }) {
  const dir = hostDir(dataDir, device.id);
  mkdirSync(dir, { recursive: true });
  const presenceFile = path.join(dir, PRESENCE_FILE);
  const startedAt = Date.now();
  let hosts = [];
  let lastHostsJson = "";
  let publishTimer = null;
  let watchTimer = null;
  let heartbeat = null;
  let poll = null;
  let watcher = null;

  // Presence is best effort: a write refused by a busy sync folder is
  // tried again on the next heartbeat, and never takes the app down.
  function writePresence(extra = {}) {
    clearTimeout(publishTimer);
    publishTimer = null;
    try {
      writeJsonAtomic(presenceFile, {
        schema: SCHEMA,
        id: device.id,
        name: device.name,
        platform: process.platform,
        app: appVersion,
        startedAt,
        seenAt: Date.now(),
        sessions: liveSessions().map(presenceSession),
        ...extra,
      });
    } catch (error) {
      console.error(`presence not written: ${error.message}`);
    }
  }

  function publish() {
    if (publishTimer) return;
    publishTimer = setTimeout(writePresence, PUBLISH_DELAY_MS);
  }

  function refresh() {
    const next = readHosts(dataDir, { exclude: device.id });
    const json = JSON.stringify(next);
    if (json === lastHostsJson) return;
    lastHostsJson = json;
    hosts = next;
    onChange();
  }

  function start() {
    writePresence();
    heartbeat = setInterval(writePresence, HEARTBEAT_MS);
    poll = setInterval(refresh, POLL_MS);
    try {
      // A sync tool may not raise events for files it brings in; polling covers that.
      watcher = watch(path.join(dataDir, HOSTS_DIR), { recursive: true }, () => {
        clearTimeout(watchTimer);
        watchTimer = setTimeout(refresh, WATCH_DEBOUNCE_MS);
      });
      watcher.on("error", () => {});
    } catch {
      // Recursive watching is not available everywhere.
    }
    refresh();
  }

  // Says goodbye so the others show this machine offline at once rather than
  // after the stale timeout.
  function stop() {
    clearInterval(heartbeat);
    clearInterval(poll);
    clearTimeout(watchTimer);
    watcher?.close();
    writePresence({ stoppedAt: Date.now(), sessions: [] });
  }

  return {
    dir,
    stateFile: path.join(dir, STATE_FILE),
    publish,
    refresh,
    hosts: () => hosts,
    start,
    stop,
  };
}
