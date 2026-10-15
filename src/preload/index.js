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
  window: {
    pin: (pinned) => ipcRenderer.send(CH.windowPin, instanceId, pinned),
    closeLock: (locked) => ipcRenderer.send(CH.windowCloseLock, instanceId, locked),
    control: (action) => ipcRenderer.send(CH.windowControl, action),
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
    pickFolder: () => ipcRenderer.invoke(CH.dialogPickFolder),
  },
});
