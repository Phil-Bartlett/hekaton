import { contextBridge, ipcRenderer } from "electron";
import { CH } from "../shared/channels.js";

function flagValue(name) {
  const prefix = `--hekaton-${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const windowKind = flagValue("window");
const instanceId = flagValue("instance");

function subscribe(channel, callback) {
  const handler = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("hekaton", {
  windowKind,
  instanceId,
  session: {
    get: () => ipcRenderer.invoke(CH.sessionGet, instanceId),
    onUpdate: (callback) => subscribe(CH.sessionUpdate, callback),
    onActivity: (callback) => subscribe(CH.sessionActivity, callback),
  },
  link: {
    open: (url) => ipcRenderer.send(CH.linkOpen, url),
  },
  window: {
    pin: (pinned) => ipcRenderer.send(CH.windowPin, instanceId, pinned),
    closeLock: (locked) => ipcRenderer.send(CH.windowCloseLock, instanceId, locked),
    control: (action) => ipcRenderer.send(CH.windowControl, action),
    tray: (open) => ipcRenderer.send(CH.windowTray, instanceId, open),
    onChrome: (callback) => subscribe(CH.windowChrome, callback),
  },
  pty: {
    attach: () => ipcRenderer.invoke(CH.ptyAttach, instanceId),
    write: (data) => ipcRenderer.send(CH.ptyWrite, instanceId, data),
    resize: (cols, rows) => ipcRenderer.send(CH.ptyResize, instanceId, cols, rows),
    onData: (callback) => subscribe(CH.ptyData, callback),
    onExit: (callback) => subscribe(CH.ptyExit, callback),
  },
  bridge: {
    getState: () => ipcRenderer.invoke(CH.bridgeGetState),
    onState: (callback) => subscribe(CH.bridgeState, callback),
    saveProfile: (profile) => ipcRenderer.invoke(CH.profileSave, profile),
    deleteProfile: (id) => ipcRenderer.invoke(CH.profileDelete, id),
    launch: (profileId) => ipcRenderer.invoke(CH.sessionLaunch, profileId),
    focus: (id) => ipcRenderer.send(CH.sessionFocus, id),
    center: (id) => ipcRenderer.send(CH.sessionCenter, id),
    bringHere: (id) => ipcRenderer.send(CH.sessionBringHere, id),
    terminate: (id) => ipcRenderer.send(CH.sessionTerminate, id),
    moveTo: (id, x, y) => ipcRenderer.send(CH.sessionMoveTo, id, x, y),
    tile: (options) => ipcRenderer.send(CH.sessionsTile, options),
    undoTile: () => ipcRenderer.send(CH.sessionsUndoTile),
    saveLayout: (name) => ipcRenderer.invoke(CH.layoutSave, name),
    applyLayout: (id) => ipcRenderer.send(CH.layoutApply, id),
    deleteLayout: (id) => ipcRenderer.send(CH.layoutDelete, id),
    checkForUpdates: () => ipcRenderer.send(CH.updateCheck),
    installUpdate: () => ipcRenderer.send(CH.updateInstall),
    resumeInstance: (id) => ipcRenderer.invoke(CH.instanceResume, id),
    dismissInstance: (id) => ipcRenderer.invoke(CH.instanceDismiss, id),
    moveInstance: (id, profileId) => ipcRenderer.invoke(CH.instanceMove, id, profileId),
    reorder: (ids) => ipcRenderer.invoke(CH.instanceOrder, ids),
    endOrphan: (id) => ipcRenderer.invoke(CH.instanceEndOrphan, id),
    conversations: () => ipcRenderer.invoke(CH.conversationsList),
    adopt: (sessionId, profileId) => ipcRenderer.invoke(CH.conversationsAdopt, sessionId, profileId),
    history: () => ipcRenderer.invoke(CH.historyList),
    resume: (entry) => ipcRenderer.invoke(CH.historyResume, entry),
    reference: () => ipcRenderer.invoke(CH.referenceList),
    openPath: (file) => ipcRenderer.invoke(CH.referenceOpen, file),
    saveSettings: (patch) => ipcRenderer.invoke(CH.settingsSave, patch),
    openDataFolder: () => ipcRenderer.invoke(CH.appOpenDataFolder),
    setDataFolder: (folder) => ipcRenderer.invoke(CH.appSetDataFolder, folder),
    pickFolder: () => ipcRenderer.invoke(CH.dialogPickFolder),
    pickFile: () => ipcRenderer.invoke(CH.dialogPickFile),
  },
});
