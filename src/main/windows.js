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

export function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: display.label || `Display ${index + 1}`,
    primary: display.id === primaryId,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  }));
}

const BOUNDS_THROTTLE_MS = 100;

// `onSessionBounds(id)` fires, throttled, whenever a session window moves or
// resizes, so the Bridge's monitor map can follow it.
export function createWindowManager({ onSessionBounds }) {
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

  function trackBounds(win, id) {
    let timer = null;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onSessionBounds(id), BOUNDS_THROTTLE_MS);
    };
    win.on("move", changed);
    win.on("resize", changed);
    win.on("closed", () => clearTimeout(timer));
  }

  function createSessionWindow(session, bounds) {
    const win = new BrowserWindow({
      ...bounds,
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
    trackBounds(win, session.id);
    if (session.profile.alwaysOnTop) {
      win.setAlwaysOnTop(true);
      chromeFor(win).pinned = true;
    }
    forwardConsole(win, session.profile.name);
    win.loadFile(path.join(RENDERER_DIR, "session", "index.html"));
    return win;
  }

  function sessionBounds(id) {
    return sessionWindow(id)?.getBounds() ?? null;
  }

  function moveSession(id, x, y) {
    const win = sessionWindow(id);
    if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const { width, height } = win.getBounds();
    const display = screen.getDisplayMatching({ x: Math.round(x), y: Math.round(y), width, height });
    fitToDisplay(win, display, { x, y });
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

  // Windows only re-fits a window to a new display's DPI during a manual
  // drag, so every programmatic move clamps the window to the destination
  // work area itself, and keeps it fully on that display.
  function fitToDisplay(win, display, position) {
    const area = display.workArea;
    const current = win.getBounds();
    const width = Math.min(current.width, area.width);
    const height = Math.min(current.height, area.height);
    const wanted = position ?? { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2 };
    const x = Math.min(Math.max(wanted.x, area.x), area.x + area.width - width);
    const y = Math.min(Math.max(wanted.y, area.y), area.y + area.height - height);
    win.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  }

  function centerSession(id) {
    const win = sessionWindow(id);
    if (!win) return;
    fitToDisplay(win, screen.getDisplayMatching(win.getBounds()));
    focusSession(id);
  }

  // Move the session window onto whichever display the Bridge is on.
  function bringSessionHere(id) {
    const win = sessionWindow(id);
    if (!win) return;
    const display =
      bridge && !bridge.isDestroyed() ? screen.getDisplayMatching(bridge.getBounds()) : screen.getPrimaryDisplay();
    fitToDisplay(win, display);
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
    sessionBounds,
    moveSession,
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
