import { app, dialog, globalShortcut, ipcMain, Notification, shell } from "electron";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { CH } from "../shared/channels.js";
import { createFx } from "./fx.js";
import { createHistory } from "./history.js";
import { createInstances, summarise } from "./instances.js";
import { computeBounds } from "./placement.js";
import { readRegistry, watchRegistry } from "./registry.js";
import { scanReference } from "./scanner.js";
import { listConversations } from "./conversations.js";
import { createDataDir } from "./dataDir.js";
import { endOutsideSession } from "./endOutside.js";
import { createSessionManager } from "./sessions.js";
import { attentionFor } from "./state.js";
import { createStore } from "./store.js";
import { TILE_LAYOUTS } from "./tiling.js";
import { startTelemetryServer } from "./telemetry.js";
import { createTray } from "./tray.js";
import { createUsage } from "./usage.js";
import { iconPath, setLaunchAtLogin } from "./platform.js";
import { boundsOnScreen, createWindowManager, listDisplays } from "./windows.js";

// xterm's ConPTY quirk handling is keyed on the Windows build number.
const OS_BUILD = Number(os.release().split(".")[2]) || 0;

function argValue(flag) {
  const prefix = `--${flag}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

// A second launch just raises the Bridge of the running instance.
if (!app.requestSingleInstanceLock()) app.quit();

const windows = createWindowManager({
  onSessionBounds: (id) => {
    recordInstance(id);
    broadcast();
  },
  onBridgeBounds: (bounds) => instances?.setBridgeBounds(bounds),
});
let sessions = null;
let dataDir = null;
let store = null;
let history = null;
let instances = null;
let fx = null;
let usage = null;
let tray = null;
let quitting = false;
let registry = [];
// Where the windows were before the last tile, for its undo.
let untile = null;
const recorded = new Set();
const lastState = new Map();

// Interrupt only for what matters, and only when the window is not in front.
function notifyIfNeeded(session) {
  const { id, profile, telemetry } = session;
  const kind = attentionFor(lastState.get(id), telemetry.state);
  lastState.set(id, telemetry.state);
  if (!kind || windows.isSessionFocused(id)) return;
  const settings = store.settings();
  if (kind === "approval" && !settings.notifyApproval) return;
  if (kind === "finished" && !settings.notifyFinished) return;
  windows.flashSession(id);
  if (!Notification.isSupported()) return;
  const name =
    telemetry.sessionName && telemetry.sessionName !== profile.name
      ? `${profile.name} · ${telemetry.sessionName}`
      : profile.name;
  const notification = new Notification({
    title: kind === "approval" ? `${name} needs an approval` : `${name} has finished`,
    body: telemetry.lastPrompt ?? "",
    silent: true,
  });
  notification.on("click", () => windows.focusSession(id));
  notification.show();
}

function showBridge() {
  windows.createBridgeWindow(instances?.bridgeBounds());
}

function applyTray(enabled) {
  if (enabled && !tray) {
    tray = createTray({
      iconPath: iconPath(),
      onShowBridge: showBridge,
      onQuit: () => {
        quitting = true;
        app.quit();
      },
    });
  } else if (!enabled && tray) {
    tray.destroy();
    tray = null;
  }
}

// The Bridge keeps a card for every session it has launched, running or not;
// the live ones are refreshed on every change so a relaunch can bring them
// back as dormant cards at their last position.
function instanceSummary(session) {
  const chrome = windows.sessionChrome(session.id);
  return summarise(session, {
    bounds: windows.sessionBounds(session.id) ?? instances.get(session.id)?.bounds ?? null,
    pinned: chrome?.pinned ?? false,
    trayOpen: session.trayOpen === true,
  });
}

function recordInstance(id) {
  const session = sessions?.get(id);
  if (session) instances.record(instanceSummary(session));
}

// Sessions Claude Code knows about that this app did not launch.
function externalSessions() {
  const own = new Set();
  for (const session of sessions.list()) {
    own.add(session.sessionId);
    if (session.telemetry.claudeSessionId) own.add(session.telemetry.claudeSessionId);
  }
  return registry.filter((row) => !own.has(row.sessionId));
}

// A saved card whose conversation is still running somewhere (a crash left
// it behind, or it was started by hand) must not be resumed on top.
function annotateOrphans(dormant) {
  const running = new Map(registry.map((row) => [row.sessionId, row.pid]));
  const host = os.hostname();
  return dormant.map((entry) => ({
    ...entry,
    runningPid: running.get(entry.claudeSessionId) ?? null,
    // Recorded on another machine through a shared data folder: its transcript is not here.
    foreignHost: entry.host && entry.host !== host ? entry.host : null,
  }));
}

function ownSessionIds() {
  const ids = new Set();
  for (const entry of instances.list()) if (entry.claudeSessionId) ids.add(entry.claudeSessionId);
  for (const session of sessions.list()) {
    ids.add(session.sessionId);
    if (session.telemetry.claudeSessionId) ids.add(session.telemetry.claudeSessionId);
  }
  return ids;
}

// Bring a conversation Claude ran on its own onto the Bridge as a saved card.
function adoptConversation(sessionId, profileId) {
  const conversation = listConversations({ exclude: new Set() }).find((row) => row.sessionId === sessionId);
  const profile = store.findProfile(profileId);
  if (!conversation || !profile) return null;
  const entry = instances.addDormant({
    id: randomUUID(),
    profileId: profile.id,
    profileName: profile.name,
    accent: profile.accent ?? null,
    colorScope: profile.colorScope ?? "border+title",
    cwd: conversation.cwd ?? profile.cwd,
    recordedCwd: conversation.cwd ?? profile.cwd,
    claudeSessionId: conversation.sessionId,
    transcriptPath: conversation.file,
    title: conversation.title,
    model: null,
    firstPrompt: conversation.firstPrompt,
    lastPrompt: conversation.firstPrompt,
    totalCostUsd: 0,
    startedAt: conversation.modifiedAt,
    lastSeenAt: conversation.modifiedAt,
    exitCode: null,
    bounds: null,
    pinned: false,
    trayOpen: false,
    host: os.hostname(),
  });
  broadcast();
  return entry;
}

function snapshot() {
  return {
    version: app.getVersion(),
    platform: process.platform,
    fx: fx.current(),
    usage: usage.current(),
    displays: listDisplays(),
    settings: store.settings(),
    dataFolder: { path: dataDir.dir, isDefault: dataDir.isDefault },
    profiles: store.profiles(),
    sessions: sessions.list().map((session) => ({ ...session, bounds: windows.sessionBounds(session.id) })),
    dormant: annotateOrphans(instances.dormant()),
    order: instances.order(),
    external: externalSessions(),
    canUndoTile: untile !== null,
  };
}

function broadcast() {
  windows.sendToBridge(CH.bridgeState, snapshot());
}

// One history line per session, written when its Claude exits or it is
// terminated while still running.
function recordHistory(session) {
  if (recorded.has(session.id)) return;
  recorded.add(session.id);
  const { profile, telemetry } = session;
  history.record({
    endedAt: Date.now(),
    startedAt: session.startedAt,
    profileId: profile.id ?? null,
    profileName: profile.name,
    accent: profile.accent ?? null,
    cwd: profile.cwd,
    firstPrompt: telemetry.firstPrompt,
    totalCostUsd: telemetry.totalCostUsd,
    claudeSessionId: telemetry.claudeSessionId,
    transcriptPath: telemetry.transcriptPath,
    exitCode: session.exitCode,
  });
}

function logUpdate({ profile, telemetry }) {
  const tool = telemetry.currentTool ? ` tool=${telemetry.currentTool}` : "";
  const ctx = telemetry.contextPct === null ? "" : ` ctx=${telemetry.contextPct}%`;
  console.log(`[${profile.name}] ${telemetry.state}${tool} cost=$${telemetry.totalCostUsd.toFixed(4)}${ctx}`);
}

function onSessionEvent(event, id, payload) {
  if (event === "data") windows.sendToSession(id, CH.ptyData, payload);
  if (event === "exit") {
    windows.sendToSession(id, CH.ptyExit, payload);
    recordHistory(sessions.get(id));
    recordInstance(id);
    broadcast();
  }
  if (event === "update") {
    logUpdate(payload);
    windows.sendToSession(id, CH.sessionUpdate, { ...payload, fx: fx.current(), settings: store.settings() });
    const name = payload.telemetry.sessionName;
    windows.setSessionTitle(
      id,
      name && name !== payload.profile.name ? `${payload.profile.name} · ${name}` : payload.profile.name,
    );
    notifyIfNeeded(payload);
    recordInstance(id);
    broadcast();
  }
  if (event === "activity") windows.sendToSession(id, CH.sessionActivity, payload);
}

// A session that ends, by any route, stays on the Bridge as a dormant card
// until it is dismissed.
function forgetSession(id) {
  const session = sessions.get(id);
  if (session) {
    recordHistory(session);
    instances.markDormant(id, instanceSummary(session));
  }
  sessions.remove(id);
  recorded.delete(id);
  lastState.delete(id);
}

// The global hotkey raises the Bridge from anywhere; an invalid accelerator
// is reported back to Settings rather than silently ignored.
function applyHotkey(accelerator) {
  globalShortcut.unregisterAll();
  if (!accelerator) return true;
  try {
    return globalShortcut.register(accelerator, () => windows.createBridgeWindow(instances?.bridgeBounds()));
  } catch {
    return false;
  }
}

// A spawn that fails throws before any window exists, so a dialog is the only
// way the user learns why nothing opened.
function reportLaunchFailure(profile, error) {
  console.error(`launch failed for "${profile.name}":`, error);
  const bridge = windows.bridgeWindow();
  const options = {
    type: "error",
    title: "Couldn't start the session",
    message: `Hekaton couldn't start "${profile.name ?? "the session"}".`,
    detail: error.message,
    buttons: ["OK"],
  };
  if (bridge) dialog.showMessageBox(bridge, options);
  else dialog.showMessageBox(options);
}

function launchProfile(profile, { id, bounds, pinned, trayOpen } = {}) {
  let session;
  try {
    session = sessions.launch(profile, { binary: store.settings().claudeBinary, id, trayOpen });
  } catch (error) {
    reportLaunchFailure(profile, error);
    return null;
  }
  const placement = boundsOnScreen(bounds) ?? computeBounds(profile, listDisplays());
  const win = windows.createSessionWindow(session, placement, { pinned });
  win.on("closed", () => {
    forgetSession(session.id);
    broadcast();
  });
  recordInstance(session.id);
  broadcast();
  return session;
}

// A dormant card comes back as the same card: same id, last window position,
// pin and tray state, on the conversation it was running.
function resumeInstance(id) {
  const entry = instances.get(id);
  if (!entry || entry.live || !entry.claudeSessionId) return null;
  const saved = store.findProfile(entry.profileId);
  const profile = saved ?? {
    name: entry.profileName,
    cwd: entry.cwd,
    accent: entry.accent ?? undefined,
    colorScope: entry.colorScope ?? "border+title",
  };
  // Resume by id keeps Claude's own name for the conversation; the bare id
  // only resolves from the folder it was recorded in, so a card moved to
  // another folder resumes by transcript path and carries its saved name.
  const cwd = entry.cwd || profile.cwd;
  const moved = entry.recordedCwd && entry.recordedCwd !== cwd;
  const byPath = moved && entry.transcriptPath && existsSync(entry.transcriptPath);
  return launchProfile(
    {
      ...profile,
      cwd,
      resume: byPath ? entry.transcriptPath : entry.claudeSessionId,
      sessionName: byPath ? entry.title : null,
    },
    { id, bounds: entry.bounds, pinned: entry.pinned, trayOpen: entry.trayOpen },
  );
}

// Moving a card re-labels it under another profile; a running session keeps
// its folder until it is next resumed, when the transcript path carries it over.
function moveInstance(id, profileId) {
  const profile = store.findProfile(profileId);
  if (!profile) return null;
  const live = sessions.get(id);
  if (live) {
    sessions.setProfile(id, {
      id: profile.id,
      name: profile.name,
      accent: profile.accent,
      colorScope: profile.colorScope,
      cwd: profile.cwd,
    });
    recordInstance(id);
    return instances.get(id);
  }
  return instances.move(id, profile);
}

// Everything still running is written out dormant before the ptys die, so a
// quit, or a Windows shutdown, never loses the cards.
function flushForQuit() {
  if (!sessions || !instances) return;
  for (const session of sessions.list()) {
    recordHistory(session);
    instances.markDormant(session.id, instanceSummary(session));
  }
  instances.saveNow();
}

function terminateSession(id) {
  forgetSession(id);
  windows.closeSessionWindow(id);
  broadcast();
}

// Resume picks the saved profile back up when it still exists, otherwise a
// stand-in built from what the history line remembers.
function resumeFromHistory(entry) {
  if (!entry?.claudeSessionId) return null;
  const saved = store.findProfile(entry.profileId);
  const profile = saved ?? {
    name: entry.profileName,
    cwd: entry.cwd,
    accent: entry.accent ?? undefined,
    colorScope: "border+title",
  };
  return launchProfile({ ...profile, cwd: entry.cwd || profile.cwd, resume: entry.claudeSessionId });
}

// A session renderer may only drive the session its own window was created
// for; Bridge-only channels are accepted from the Bridge alone.
function ownsInstance(event, id) {
  return windows.sessionWindow(id)?.webContents.id === event.sender.id;
}

function fromBridge(event) {
  return windows.bridgeWindow()?.webContents.id === event.sender.id;
}

ipcMain.handle(CH.sessionGet, (event, id) =>
  ownsInstance(event, id)
    ? {
        ...sessions.get(id),
        osBuild: OS_BUILD,
        platform: process.platform,
        chrome: windows.sessionChrome(id),
        fx: fx.current(),
        settings: store.settings(),
      }
    : null,
);
ipcMain.handle(CH.ptyAttach, (event, id) => (ownsInstance(event, id) ? sessions.attach(id) : null));
ipcMain.on(CH.ptyWrite, (event, id, data) => {
  if (ownsInstance(event, id)) sessions.write(id, data);
});
ipcMain.on(CH.ptyResize, (event, id, cols, rows) => {
  if (ownsInstance(event, id)) sessions.resize(id, cols, rows);
});
ipcMain.on(CH.windowPin, (event, id, pinned) => {
  if (ownsInstance(event, id)) windows.pinSession(id, pinned === true);
});
ipcMain.on(CH.windowCloseLock, (event, id, locked) => {
  if (ownsInstance(event, id)) windows.lockSession(id, locked === true);
});
ipcMain.on(CH.windowControl, (event, action) => windows.controlWindow(event.sender, action));
// Links clicked in a terminal open in the default browser; only web and mail
// schemes are allowed through.
ipcMain.on(CH.linkOpen, (event, url) => {
  if (typeof url === "string" && /^(https?|mailto):/i.test(url)) shell.openExternal(url);
});
ipcMain.on(CH.windowTray, (event, id, open) => {
  if (ownsInstance(event, id)) sessions.setTray(id, open === true);
});

ipcMain.handle(CH.bridgeGetState, (event) => (fromBridge(event) ? snapshot() : null));
ipcMain.handle(CH.profileSave, (event, profile) => {
  if (!fromBridge(event)) return null;
  const saved = store.saveProfile(profile);
  broadcast();
  return saved;
});
ipcMain.handle(CH.profileDelete, (event, id) => {
  if (!fromBridge(event)) return;
  store.deleteProfile(id);
  broadcast();
});
ipcMain.handle(CH.sessionLaunch, (event, profileId) => {
  if (!fromBridge(event)) return null;
  const profile = store.findProfile(profileId);
  if (!profile) throw new Error("Unknown profile");
  return launchProfile(profile);
});
ipcMain.on(CH.sessionFocus, (event, id) => {
  if (fromBridge(event)) windows.focusSession(id);
});
ipcMain.on(CH.sessionCenter, (event, id) => {
  if (fromBridge(event)) windows.centerSession(id);
});
ipcMain.on(CH.sessionBringHere, (event, id) => {
  if (fromBridge(event)) windows.bringSessionHere(id);
});
ipcMain.on(CH.sessionTerminate, (event, id) => {
  if (fromBridge(event)) terminateSession(id);
});
ipcMain.on(CH.sessionMoveTo, (event, id, x, y) => {
  if (fromBridge(event)) windows.moveSession(id, x, y);
});
// The Bridge sends the live cards it is showing, in its own order, so a
// tile follows the sort and profile filter on screen.
ipcMain.on(CH.sessionsTile, (event, { ids, displayId = null, layout } = {}) => {
  if (!fromBridge(event) || !Array.isArray(ids)) return;
  const live = new Set(sessions.list().map((session) => session.id));
  const tiled = ids.filter((id) => live.has(id));
  if (tiled.length === 0) return;
  const { tiling } = store.settings();
  untile = windows.tileSessions(tiled, displayId, {
    layout: TILE_LAYOUTS.includes(layout) ? layout : tiling.layout,
    gap: tiling.gap,
  });
  broadcast();
});
ipcMain.on(CH.sessionsUndoTile, (event) => {
  if (!fromBridge(event) || !untile) return;
  windows.restoreSessions(untile);
  untile = null;
  broadcast();
});

const MAX_LAYOUT_NAME = 60;

// A named layout remembers where every live card's window sits. Cards keep
// their id across a relaunch and resume, so applying it later moves
// whichever of them are live again; saving under an existing name replaces it.
function saveLayout(name) {
  const trimmed = String(name ?? "")
    .trim()
    .slice(0, MAX_LAYOUT_NAME);
  const ids = sessions.list().map((session) => session.id);
  if (!trimmed || ids.length === 0) return null;
  const layout = { id: randomUUID(), name: trimmed, savedAt: Date.now(), placements: windows.captureSessions(ids) };
  const others = store.settings().layouts.filter((existing) => existing.name !== trimmed);
  store.saveSettings({ layouts: [...others, layout] });
  broadcast();
  return layout;
}

// A position on a display that has since gone is skipped, not applied.
function applyLayout(id) {
  const layout = store.settings().layouts.find((candidate) => candidate.id === id);
  if (!layout) return;
  const placements = Object.fromEntries(
    Object.entries(layout.placements).filter(
      ([cardId, placement]) => windows.sessionWindow(cardId) && boundsOnScreen(placement.bounds),
    ),
  );
  if (Object.keys(placements).length === 0) return;
  untile = windows.captureSessions(Object.keys(placements));
  windows.restoreSessions(placements);
  broadcast();
}

ipcMain.handle(CH.layoutSave, (event, name) => (fromBridge(event) ? saveLayout(name) : null));
ipcMain.on(CH.layoutApply, (event, id) => {
  if (fromBridge(event)) applyLayout(id);
});
ipcMain.on(CH.layoutDelete, (event, id) => {
  if (!fromBridge(event)) return;
  store.saveSettings({ layouts: store.settings().layouts.filter((layout) => layout.id !== id) });
  broadcast();
});
ipcMain.handle(CH.instanceResume, (event, id) => (fromBridge(event) ? resumeInstance(id) : null));
ipcMain.handle(CH.instanceDismiss, (event, id) => {
  if (!fromBridge(event)) return false;
  const removed = instances.dismiss(id);
  if (removed) broadcast();
  return removed;
});
ipcMain.handle(CH.instanceMove, (event, id, profileId) => {
  if (!fromBridge(event)) return null;
  const moved = moveInstance(id, profileId);
  if (moved) broadcast();
  return moved;
});
ipcMain.handle(CH.conversationsList, (event) =>
  fromBridge(event) ? listConversations({ exclude: ownSessionIds() }) : [],
);
ipcMain.handle(CH.conversationsAdopt, (event, sessionId, profileId) =>
  fromBridge(event) ? adoptConversation(sessionId, profileId) : null,
);
// End the Claude process running a saved card's conversation outside
// Hekaton, so the card can be resumed here.
ipcMain.handle(CH.instanceEndOrphan, async (event, id) => {
  if (!fromBridge(event)) return false;
  const pid = annotateOrphans([instances.get(id)].filter(Boolean))[0]?.runningPid;
  if (!pid) return false;
  const { ended } = await endOutsideSession(pid);
  registry = readRegistry();
  broadcast();
  return ended;
});
ipcMain.handle(CH.instanceOrder, (event, ids) => {
  if (!fromBridge(event) || !Array.isArray(ids)) return null;
  instances.setOrder(ids.filter((id) => typeof id === "string"));
  broadcast();
  return instances.order();
});
ipcMain.handle(CH.historyList, (event) => (fromBridge(event) ? history.list() : []));
ipcMain.handle(CH.referenceList, (event) =>
  fromBridge(event)
    ? scanReference({
        projectDirs: store.profiles().map((profile) => profile.cwd),
        customRoots: store.settings().referenceRoots,
      })
    : [],
);
// Only Markdown files may be opened, which is everything the scanner lists.
ipcMain.handle(CH.referenceOpen, (event, file) =>
  fromBridge(event) && typeof file === "string" && file.endsWith(".md") ? shell.openPath(file) : null,
);
ipcMain.handle(CH.settingsSave, (event, patch) => {
  if (!fromBridge(event) || !patch || typeof patch !== "object") return null;
  const saved = store.saveSettings(patch);
  const hotkeyOk = "hotkey" in patch ? applyHotkey(saved.hotkey) : true;
  if ("keepInTray" in patch) applyTray(saved.keepInTray);
  if ("launchAtLogin" in patch) setLaunchAtLogin(saved.launchAtLogin);
  broadcast();
  // Session windows restyle live: fonts, status colours and theme all come from here.
  for (const session of sessions.list()) {
    windows.sendToSession(session.id, CH.sessionUpdate, { ...session, fx: fx.current(), settings: saved });
  }
  return { ...saved, hotkeyOk };
});
ipcMain.handle(CH.historyResume, (event, entry) => (fromBridge(event) ? resumeFromHistory(entry) : null));
ipcMain.handle(CH.dialogPickFolder, async (event) => {
  if (!fromBridge(event)) return null;
  const result = await dialog.showOpenDialog(windows.bridgeWindow(), { properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle(CH.dialogPickFile, async (event) => {
  if (!fromBridge(event)) return null;
  const result = await dialog.showOpenDialog(windows.bridgeWindow(), { properties: ["openFile"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle(CH.appOpenDataFolder, (event) => (fromBridge(event) ? shell.openPath(dataDir.dir) : null));
// Every store is bound to a path at start-up, so switching folders restarts
// the app. The pointer moves after before-quit has flushed the cards, so the
// seed copy carries them.
ipcMain.handle(CH.appSetDataFolder, (event, folder) => {
  if (!fromBridge(event)) return false;
  const next = typeof folder === "string" && folder ? folder : null;
  app.once("will-quit", () => dataDir.set(next));
  quitting = true;
  app.relaunch();
  app.quit();
  return true;
});

app.on("second-instance", () => windows.createBridgeWindow(instances?.bridgeBounds()));

app.whenReady().then(async () => {
  const telemetryServer = await startTelemetryServer((kind, id, payload, meta) => {
    if (kind === "hook") return sessions.applyHook(id, payload);
    usage.update(payload);
    return sessions.applyStatus(id, payload, meta);
  });
  console.log(`telemetry receiver on 127.0.0.1:${telemetryServer.port}`);
  dataDir = createDataDir();
  store = createStore({ dir: dataDir.dir });
  history = createHistory({ dir: dataDir.dir });
  instances = createInstances({ file: path.join(dataDir.dir, "state.json") });
  fx = createFx();
  usage = createUsage();
  sessions = createSessionManager(onSessionEvent, telemetryServer);
  watchRegistry((rows) => {
    registry = rows;
    broadcast();
  });
  applyTray(store.settings().keepInTray);
  // `--hidden` (the launch-at-login argument) starts in the tray only.
  if (!(process.argv.includes("--hidden") && tray)) showBridge();
  applyHotkey(store.settings().hotkey);

  // `hekaton --launch=<profile name or id>` opens a session straight away.
  const launch = argValue("launch");
  if (launch) {
    const profile = store.findProfile(launch);
    if (profile) launchProfile(profile);
    else console.error(`--launch: no profile named "${launch}"`);
  }
});

// With a tray the app lives on after its last window; without one it ends.
app.on("window-all-closed", () => {
  if (!tray || quitting) app.quit();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("session-end", flushForQuit);
app.on("before-quit", () => {
  flushForQuit();
  sessions?.killAll();
});
