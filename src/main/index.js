import { app, dialog, ipcMain, shell } from "electron";
import os from "node:os";
import { CH } from "../shared/channels.js";
import { createFx } from "./fx.js";
import { createHistory } from "./history.js";
import { computeBounds } from "./placement.js";
import { watchRegistry } from "./registry.js";
import { scanReference } from "./scanner.js";
import { createSessionManager } from "./sessions.js";
import { createStore } from "./store.js";
import { startTelemetryServer } from "./telemetry.js";
import { createUsage } from "./usage.js";
import { createWindowManager, listDisplays } from "./windows.js";

// xterm's ConPTY quirk handling is keyed on the Windows build number.
const OS_BUILD = Number(os.release().split(".")[2]) || 0;

function argValue(flag) {
  const prefix = `--${flag}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

// A second launch just raises the Bridge of the running instance.
if (!app.requestSingleInstanceLock()) app.quit();

const windows = createWindowManager({ onSessionBounds: () => broadcast() });
let sessions = null;
let store = null;
let history = null;
let fx = null;
let usage = null;
let registry = [];
const recorded = new Set();

// Sessions Claude Code knows about that this app did not launch.
function externalSessions() {
  const own = new Set();
  for (const session of sessions.list()) {
    own.add(session.sessionId);
    if (session.telemetry.claudeSessionId) own.add(session.telemetry.claudeSessionId);
  }
  return registry.filter((row) => !own.has(row.sessionId));
}

function snapshot() {
  return {
    version: app.getVersion(),
    platform: process.platform,
    fx: fx.current(),
    usage: usage.current(),
    displays: listDisplays(),
    settings: store.settings(),
    profiles: store.profiles(),
    sessions: sessions.list().map((session) => ({ ...session, bounds: windows.sessionBounds(session.id) })),
    external: externalSessions(),
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
    broadcast();
  }
  if (event === "update") {
    logUpdate(payload);
    windows.sendToSession(id, CH.sessionUpdate, { ...payload, fx: fx.current() });
    broadcast();
  }
  if (event === "activity") windows.sendToSession(id, CH.sessionActivity, payload);
}

function forgetSession(id) {
  const session = sessions.get(id);
  if (session) recordHistory(session);
  sessions.remove(id);
  recorded.delete(id);
}

function launchProfile(profile) {
  const session = sessions.launch(profile);
  const win = windows.createSessionWindow(session, computeBounds(profile, listDisplays()));
  win.on("closed", () => {
    forgetSession(session.id);
    broadcast();
  });
  broadcast();
  return session;
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
    ? { ...sessions.get(id), osBuild: OS_BUILD, platform: process.platform, fx: fx.current() }
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
  broadcast();
  return saved;
});
ipcMain.handle(CH.historyResume, (event, entry) => (fromBridge(event) ? resumeFromHistory(entry) : null));
ipcMain.handle(CH.dialogPickFolder, async (event) => {
  if (!fromBridge(event)) return null;
  const result = await dialog.showOpenDialog(windows.bridgeWindow(), { properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

app.on("second-instance", () => windows.createBridgeWindow());

app.whenReady().then(async () => {
  const telemetryServer = await startTelemetryServer((kind, id, payload) => {
    if (kind === "hook") return sessions.applyHook(id, payload);
    usage.update(payload);
    return sessions.applyStatus(id, payload);
  });
  console.log(`telemetry receiver on 127.0.0.1:${telemetryServer.port}`);
  store = createStore();
  history = createHistory();
  fx = createFx();
  usage = createUsage();
  sessions = createSessionManager(onSessionEvent, telemetryServer);
  watchRegistry((rows) => {
    registry = rows;
    broadcast();
  });
  windows.createBridgeWindow();

  // `hekaton --launch=<profile name or id>` opens a session straight away.
  const launch = argValue("launch");
  if (launch) {
    const profile = store.findProfile(launch);
    if (profile) launchProfile(profile);
    else console.error(`--launch: no profile named "${launch}"`);
  }
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => sessions?.killAll());
