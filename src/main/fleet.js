import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./jsonFile.js";

// Several Hekatons can share one data folder, one per machine. Each writes
// only under hosts/<deviceId>/: its own cards (state.json), a presence file
// (host.json) carrying its live sessions and a heartbeat, and the results
// of commands it has carried out. The one thing a machine puts in another's
// folder is a new file in its inbox/, asking it to do something; the owner
// deletes it once done. No two machines ever write the same file, so a sync
// tool has nothing to merge.
//
// A hub (server/hub.js), when one is paired, carries the same presence and
// commands over a socket for the machines connected to it, which is faster
// than a synced folder and works without one. The folder stays the fallback
// for any machine the hub cannot see.

export const HOSTS_DIR = "hosts";
export const PRESENCE_FILE = "host.json";
export const STATE_FILE = "state.json";
export const DEVICE_FILE = "device.json";
export const INBOX_DIR = "inbox";
export const RESULTS_DIR = "results";
export const COMMAND_TYPES = Object.freeze(["terminate", "resume"]);
export const HEARTBEAT_MS = 5000;
// Generous, because the files may arrive through OneDrive or Syncthing.
export const STALE_MS = 60_000;
export const COMMAND_MAX_AGE_MS = 5 * 60_000;
export const RESULT_KEEP_MS = 10 * 60_000;
export const PENDING_TIMEOUT_MS = 30_000;
const ERROR_SHOWN_MS = 30_000;
const POLL_MS = 3000;
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

function remove(file) {
  rmSync(file, { force: true });
}

// A machine's identity: a random id minted on first run and kept in the
// local user-data folder, never the shared one, so a renamed machine keeps
// its cards and two machines with the same hostname stay apart. The hub
// pairing (address and this machine's token) lives here too, for the same
// reason: it is this machine's alone.
export function readDevice(file, { hostname = os.hostname(), uuid = randomUUID } = {}) {
  const parsed = readJson(file);
  if (typeof parsed?.id === "string" && parsed.id) {
    const hub =
      typeof parsed.hub?.url === "string" && typeof parsed.hub?.token === "string"
        ? { url: parsed.hub.url, token: parsed.hub.token }
        : null;
    return { id: parsed.id, name: typeof parsed.name === "string" && parsed.name ? parsed.name : hostname, hub };
  }
  const device = { id: uuid(), name: hostname, hub: null };
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, device);
  return device;
}

export function writeDevice(file, device) {
  writeJsonAtomic(file, { id: device.id, name: device.name, hub: device.hub ?? null });
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

// The folder's view and the hub's view of the other machines, as one list.
// A machine the hub can see right now is taken from the hub, which is
// fresher; otherwise the folder's word stands.
export function mergeHosts(folderHosts, hubHosts) {
  const byId = new Map(folderHosts.map((host) => [host.id, { ...host, via: "folder" }]));
  for (const host of hubHosts) {
    const folder = byId.get(host.id);
    if (host.online || !folder) byId.set(host.id, { ...host, via: "hub" });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// Ask another machine to do something with one of its cards. The request is
// a new file in that machine's inbox, named by its own id.
export function sendCommand(dataDir, { to, from, type, cardId, uuid = randomUUID, now = Date.now() }) {
  const command = { id: uuid(), to, from, type, cardId, sentAt: now };
  const file = path.join(hostDir(dataDir, to), INBOX_DIR, `${command.id}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, command);
  return command;
}

// What is waiting in a machine's inbox, oldest first. Anything malformed,
// addressed elsewhere or older than a few minutes (sent while this machine
// was away, say) is deleted unread rather than acted on late.
export function readInbox(dir, { self, now = Date.now() }) {
  const inbox = path.join(dir, INBOX_DIR);
  let names;
  try {
    names = readdirSync(inbox).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const commands = [];
  for (const name of names) {
    const file = path.join(inbox, name);
    const command = readJson(file);
    if (!command) continue; // still arriving; next pass
    const wellFormed =
      typeof command.id === "string" &&
      command.to === self &&
      COMMAND_TYPES.includes(command.type) &&
      typeof command.cardId === "string";
    if (!wellFormed || now - (command.sentAt ?? 0) > COMMAND_MAX_AGE_MS) {
      remove(file);
      continue;
    }
    commands.push({ ...command, file });
  }
  return commands.sort((a, b) => a.sentAt - b.sentAt);
}

export function writeResult(dir, { id, ok, error = null, now = Date.now() }) {
  const file = path.join(dir, RESULTS_DIR, `${id}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { id, ok, error, at: now });
}

export function readResult(dataDir, hostId, commandId) {
  return readJson(path.join(hostDir(dataDir, hostId), RESULTS_DIR, `${commandId}.json`));
}

// Results are only read by the machine that asked, within seconds; the rest
// is litter.
export function pruneResults(dir, now = Date.now()) {
  const results = path.join(dir, RESULTS_DIR);
  let names;
  try {
    names = readdirSync(results);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(results, name);
    const result = readJson(file);
    if (!result || now - (result.at ?? 0) > RESULT_KEEP_MS) remove(file);
  }
}

// Publishes this machine's presence, follows every other machine's, carries
// out what they ask and tracks what this machine has asked of them.
// `liveSessions()` and `dormantCards()` are asked for what to publish;
// `onCommand(command)` carries one out and returns `{ ok, error }`;
// `onChange()` fires when what the Bridge should show has changed.
export function createFleet({
  dataDir,
  device,
  appVersion,
  liveSessions,
  dormantCards = () => [],
  onCommand,
  onChange,
}) {
  const dir = hostDir(dataDir, device.id);
  mkdirSync(dir, { recursive: true });
  const presenceFile = path.join(dir, PRESENCE_FILE);
  const startedAt = Date.now();
  let folderHosts = [];
  let hubHosts = [];
  let hosts = [];
  let lastHostsJson = "";
  // Commands this machine has sent and not yet heard back about, by id.
  const pending = new Map();
  let hub = null;
  let publishTimer = null;
  let watchTimer = null;
  let heartbeat = null;
  let poll = null;
  let watcher = null;
  let ticking = false;

  function presencePayload() {
    return { sessions: liveSessions().map(presenceSession), dormant: dormantCards() };
  }

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
    hub?.sendPresence();
  }

  function publish() {
    if (publishTimer) return;
    publishTimer = setTimeout(writePresence, PUBLISH_DELAY_MS);
  }

  function recompute() {
    const next = mergeHosts(folderHosts, hubHosts);
    const json = JSON.stringify(next);
    if (json === lastHostsJson) return false;
    lastHostsJson = json;
    hosts = next;
    return true;
  }

  function refreshHosts() {
    folderHosts = readHosts(dataDir, { exclude: device.id });
    return recompute();
  }

  function setHubHosts(next) {
    hubHosts = next;
    if (recompute()) onChange();
  }

  // Each request is answered then deleted, in that order, so a crash in
  // between repeats the request rather than losing it; both commands are
  // harmless to repeat.
  async function handleInbox() {
    let changed = false;
    for (const command of readInbox(dir, { self: device.id })) {
      let result;
      try {
        result = await onCommand(command);
      } catch (error) {
        result = { ok: false, error: error.message };
      }
      writeResult(dir, { id: command.id, ok: result?.ok === true, error: result?.error ?? null });
      remove(command.file);
      changed = true;
    }
    pruneResults(dir);
    return changed;
  }

  function fail(entry, error, now = Date.now()) {
    Object.assign(entry, { error, failedAt: now });
  }

  // An answer to one of this machine's requests, however it arrived.
  function settle(id, ok, error, now = Date.now()) {
    const entry = pending.get(id);
    if (!entry || entry.error) return false;
    if (ok) pending.delete(id);
    else fail(entry, error || "Refused", now);
    return true;
  }

  // A sent command is pending until its result arrives or it times out; a
  // failure stays on show for a while so the Bridge can say why.
  function checkPending(now = Date.now()) {
    let changed = false;
    for (const entry of pending.values()) {
      if (entry.error) {
        if (now - entry.failedAt > ERROR_SHOWN_MS) {
          pending.delete(entry.id);
          changed = true;
        }
        continue;
      }
      const result = entry.via === "folder" ? readResult(dataDir, entry.hostId, entry.id) : null;
      if (result) {
        settle(entry.id, result.ok, result.error, now);
        changed = true;
      } else if (now - entry.sentAt > PENDING_TIMEOUT_MS) {
        fail(entry, "No answer from that machine", now);
        changed = true;
      }
    }
    return changed;
  }

  async function refresh() {
    if (ticking) return;
    ticking = true;
    try {
      const hostsChanged = refreshHosts();
      const inboxChanged = await handleInbox();
      const pendingChanged = checkPending();
      if (hostsChanged || inboxChanged || pendingChanged) onChange();
    } finally {
      ticking = false;
    }
  }

  // Only a machine that is online right now can act; a request to one that
  // is away would wait in its inbox and then be dropped as too old. The hub
  // carries the request when it can see the machine, the folder otherwise.
  function send(hostId, type, cardId) {
    const host = hosts.find((candidate) => candidate.id === hostId);
    if (!host) return { ok: false, error: "Unknown machine" };
    if (!host.online) return { ok: false, error: `${host.name} is not running Hekaton right now` };
    if (!COMMAND_TYPES.includes(type)) return { ok: false, error: "Unknown command" };
    let command;
    let via;
    if (host.via === "hub" && hub?.online()) {
      via = "hub";
      command = { id: randomUUID(), to: hostId, from: device.id, type, cardId, sentAt: Date.now() };
      hub.sendCommand({ id: command.id, to: hostId, command: type, cardId, sentAt: command.sentAt });
    } else {
      via = "folder";
      command = sendCommand(dataDir, { to: hostId, from: device.id, type, cardId });
    }
    pending.set(command.id, { id: command.id, hostId, type, cardId, sentAt: command.sentAt, via, error: null });
    onChange();
    return { ok: true, id: command.id };
  }

  // The hub client is made by the caller (it needs this fleet's callbacks)
  // and handed over here; `null` takes it away again.
  function attachHub(client) {
    hub = client;
    if (!client) setHubHosts([]);
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
    return refresh();
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
    send,
    settle: (id, ok, error) => {
      if (settle(id, ok, error)) onChange();
    },
    presencePayload,
    setHubHosts,
    attachHub,
    hosts: () => hosts,
    pending: () => [...pending.values()],
    start,
    stop,
  };
}
