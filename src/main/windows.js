import { BrowserWindow, dialog, screen } from "electron";
import path from "node:path";
import { CH } from "../shared/channels.js";
import { IS_WINDOWS, titleBarOptions } from "./platform.js";

// The main bundle lives at dist/main.cjs, so __dirname is dist/.
const PRELOAD = path.join(__dirname, "preload.cjs");
const RENDERER_DIR = path.join(__dirname, "renderer");

const TITLE_BAR_HEIGHT = 36;
const BACKGROUND = "#1a1a1a";

function webPreferences(args) {
  return {
    preload: PRELOAD,
    additionalArguments: args,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  };
}

function forwardConsole(win, label) {
  win.webContents.on("console-message", ({ level, message, sourceId, lineNumber }) => {
    if (level === "warning" || level === "error") {
      console.error(`[renderer ${label}] ${level}: ${message} (${sourceId}:${lineNumber})`);
    }
  });
}

export function createWindowManager() {
  const sessionWindows = new Map();
  // Title-bar state the renderer draws, keyed by BrowserWindow id: the
  // maximise toggle for every window, always-on-top and the close lock for
  // session windows.
  const chromeState = new Map();
  let bridge = null;

  function chromeFor(win) {
    if (!chromeState.has(win.id)) chromeState.set(win.id, { pinned: false, locked: false, maximized: false });
    return chromeState.get(win.id);
  }

  function pushChrome(win) {
    if (!win.isDestroyed()) win.webContents.send(CH.windowChrome, chromeFor(win));
  }

  function trackChrome(win) {
    const setMaximized = (maximized) => () => {
      chromeFor(win).maximized = maximized;
      pushChrome(win);
    };
    win.on("maximize", setMaximized(true));
    win.on("unmaximize", setMaximized(false));
    win.webContents.on("did-finish-load", () => pushChrome(win));
    win.on("closed", () => chromeState.delete(win.id));
  }

  function createBridgeWindow() {
    if (bridge && !bridge.isDestroyed()) {
      showBridge();
      return bridge;
    }
    bridge = new BrowserWindow({
      width: 1180,
      height: 830,
      minWidth: 720,
      minHeight: 480,
      backgroundColor: BACKGROUND,
      title: "Hekaton",
      ...titleBarOptions({ height: TITLE_BAR_HEIGHT }),
      webPreferences: webPreferences(["--hekaton-window=bridge"]),
    });
    bridge.on("page-title-updated", (event) => event.preventDefault());
    bridge.on("closed", () => {
      bridge = null;
    });
    trackChrome(bridge);
    forwardConsole(bridge, "bridge");
    bridge.loadFile(path.join(RENDERER_DIR, "bridge", "index.html"));
    return bridge;
  }

  function showBridge() {
    if (!bridge || bridge.isDestroyed()) return;
    if (bridge.isMinimized()) bridge.restore();
    bridge.show();
    bridge.focus();
  }

  function createSessionWindow(session) {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 480,
      minHeight: 240,
      backgroundColor: BACKGROUND,
      title: session.profile.name,
      // Square corners so the accent frame meets at the corners on Windows 11.
      ...(IS_WINDOWS && { roundedCorners: false }),
      ...titleBarOptions({ height: TITLE_BAR_HEIGHT }),
      webPreferences: webPreferences(["--hekaton-window=session", `--hekaton-instance=${session.id}`]),
    });
    sessionWindows.set(session.id, win);
    win.on("closed", () => sessionWindows.delete(session.id));
    // Keep the OS-level title as the profile name; the page's <title> is not it.
    win.on("page-title-updated", (event) => event.preventDefault());
    // A locked window ignores close entirely; a profile can also ask for a
    // confirmation, since closing the window ends the Claude session.
    win.on("close", (event) => {
      if (chromeFor(win).locked) {
        event.preventDefault();
        return;
      }
      if (!session.profile.confirmClose) return;
      const choice = dialog.showMessageBoxSync(win, {
        type: "question",
        buttons: ["Close", "Keep open"],
        defaultId: 1,
        cancelId: 1,
        message: `Close ${session.profile.name}?`,
        detail: "The Claude session in this window will end.",
      });
      if (choice === 1) event.preventDefault();
    });
    trackChrome(win);
    forwardConsole(win, session.profile.name);
    win.loadFile(path.join(RENDERER_DIR, "session", "index.html"));
    return win;
  }

  function sessionWindow(id) {
    const win = sessionWindows.get(id);
    return win && !win.isDestroyed() ? win : null;
  }

  function sendToSession(id, channel, ...args) {
    sessionWindow(id)?.webContents.send(channel, ...args);
  }

  function sendToBridge(channel, ...args) {
    if (bridge && !bridge.isDestroyed()) bridge.webContents.send(channel, ...args);
  }

  function focusSession(id) {
    const win = sessionWindow(id);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function centerSession(id) {
    sessionWindow(id)?.center();
    focusSession(id);
  }

  // Move the session window onto whichever display the Bridge is on.
  function bringSessionHere(id) {
    const win = sessionWindow(id);
    if (!win) return;
    const display =
      bridge && !bridge.isDestroyed() ? screen.getDisplayMatching(bridge.getBounds()) : screen.getPrimaryDisplay();
    const { x, y, width, height } = display.workArea;
    const [w, h] = win.getSize();
    win.setPosition(Math.round(x + (width - w) / 2), Math.round(y + (height - h) / 2));
    focusSession(id);
  }

  function closeSessionWindow(id) {
    sessionWindow(id)?.destroy();
  }

  function pinSession(id, pinned) {
    const win = sessionWindow(id);
    if (!win) return;
    win.setAlwaysOnTop(pinned);
    chromeFor(win).pinned = pinned;
    pushChrome(win);
  }

  function lockSession(id, locked) {
    const win = sessionWindow(id);
    if (!win) return;
    chromeFor(win).locked = locked;
    pushChrome(win);
  }

  // Caption buttons drawn by a renderer act on the window that sent them.
  function controlWindow(webContents, action) {
    const win = BrowserWindow.fromWebContents(webContents);
    if (!win || win.isDestroyed()) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") (win.isMaximized() ? win.unmaximize : win.maximize).call(win);
    else if (action === "close") win.close();
  }

  return {
    createBridgeWindow,
    showBridge,
    bridgeWindow: () => (bridge && !bridge.isDestroyed() ? bridge : null),
    createSessionWindow,
    sessionWindow,
    sendToSession,
    sendToBridge,
    focusSession,
    centerSession,
    bringSessionHere,
    closeSessionWindow,
    pinSession,
    lockSession,
    controlWindow,
  };
}
