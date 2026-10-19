import { BrowserWindow, dialog, screen } from "electron";
import path from "node:path";
import { CH } from "../shared/channels.js";
import { MIN_HEIGHT, MIN_WIDTH } from "./placement.js";
import { IS_WINDOWS, titleBarOptions } from "./platform.js";
import { tileRects } from "./tiling.js";

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
const MIN_VISIBLE_PX = 120;

// Saved bounds are only trusted when a decent slice of the window would
// still land on a connected display; a monitor may have gone since.
export function boundsOnScreen(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.width)) return null;
  const visible = screen.getAllDisplays().some(({ workArea }) => {
    const w = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const h = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return w >= MIN_VISIBLE_PX && h >= MIN_VISIBLE_PX;
  });
  return visible ? bounds : null;
}

function throttled(fn) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, BOUNDS_THROTTLE_MS);
  };
}

// `onSessionBounds(id)` and `onBridgeBounds(bounds)` fire, throttled, whenever
// a window moves or resizes, so the monitor map follows and the layout is saved.
export function createWindowManager({ onSessionBounds, onBridgeBounds }) {
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

  function createBridgeWindow(savedBounds) {
    if (bridge && !bridge.isDestroyed()) {
      showBridge();
      return bridge;
    }
    bridge = new BrowserWindow({
      ...(boundsOnScreen(savedBounds) ?? { width: 1180, height: 830 }),
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
    const bridgeMoved = throttled(() => {
      if (bridge && !bridge.isDestroyed() && !bridge.isMinimized()) onBridgeBounds(bridge.getBounds());
    });
    bridge.on("move", bridgeMoved);
    bridge.on("resize", bridgeMoved);
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
    const changed = throttled(() => {
      if (!win.isDestroyed() && !win.isMinimized()) onSessionBounds(id);
    });
    win.on("move", changed);
    win.on("resize", changed);
  }

  function createSessionWindow(session, bounds, { pinned = false } = {}) {
    const win = new BrowserWindow({
      ...bounds,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
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
    if (session.profile.alwaysOnTop || pinned) {
      win.setAlwaysOnTop(true);
      chromeFor(win).pinned = true;
    }
    forwardConsole(win, session.profile.name);
    win.loadFile(path.join(RENDERER_DIR, "session", "index.html"));
    return win;
  }

  function sessionBounds(id) {
    const win = sessionWindow(id);
    return win && !win.isMinimized() ? win.getBounds() : null;
  }

  function sessionChrome(id) {
    const win = sessionWindow(id);
    return win ? chromeFor(win) : null;
  }

  // OS-level title: the profile, plus Claude's own name for the conversation
  // once it has one, so Alt+Tab and the taskbar tell sessions apart.
  function setSessionTitle(id, title) {
    const win = sessionWindow(id);
    if (win && win.getTitle() !== title) win.setTitle(title);
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

  // The size is applied in a second step: Electron scales a bounds call by
  // the DPI of the display the window is leaving, and Windows rescales it
  // again on arrival, so a single call lands at the wrong size when the two
  // displays differ.
  function placeWindow(win, target) {
    win.setPosition(target.x, target.y);
    const settle = (attempt) => {
      if (win.isDestroyed()) return;
      const now = win.getBounds();
      const matches = ["x", "y", "width", "height"].every((key) => Math.abs(now[key] - target[key]) <= 1);
      if (matches) return;
      win.setBounds(target);
      if (attempt < 3) setTimeout(() => settle(attempt + 1), 80);
    };
    setTimeout(() => settle(0), 50);
  }

  // Windows only re-fits a window to a new display's DPI during a manual
  // drag, so every programmatic move clamps the window to the destination
  // work area itself and keeps it fully on that display.
  function fitToDisplay(win, display, position) {
    const area = display.workArea;
    const current = win.getBounds();
    const width = Math.min(current.width, area.width);
    const height = Math.min(current.height, area.height);
    const wanted = position ?? { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2 };
    const x = Math.round(Math.min(Math.max(wanted.x, area.x), area.x + area.width - width));
    const y = Math.round(Math.min(Math.max(wanted.y, area.y), area.y + area.height - height));
    placeWindow(win, { x, y, width, height });
  }

  // Where each window is now, in a form restoreSessions can put back.
  function captureSessions(ids) {
    const placements = {};
    for (const id of ids) {
      const win = sessionWindow(id);
      if (!win) continue;
      const maximized = win.isMaximized();
      const minimized = win.isMinimized();
      // getNormalBounds is a few pixels out for a frameless window that is
      // neither, so it is only used when the window is not at its normal size.
      placements[id] = {
        bounds: maximized || minimized ? win.getNormalBounds() : win.getBounds(),
        maximized,
        minimized,
      };
    }
    return placements;
  }

  // Lays the windows out, in the order given, across the display's work
  // area; the Bridge's display when none is named. A full-screen window is
  // left where it is (macOS will not move one). Returns where they were.
  function tileSessions(ids, displayId, options) {
    const displays = screen.getAllDisplays();
    const display =
      displays.find((candidate) => String(candidate.id) === String(displayId)) ??
      (bridge && !bridge.isDestroyed() ? screen.getDisplayMatching(bridge.getBounds()) : screen.getPrimaryDisplay());
    const tiled = ids.filter((id) => sessionWindow(id) && !sessionWindow(id).isFullScreen());
    const before = captureSessions(tiled);
    const rects = tileRects(tiled.length, display.workArea, options);
    tiled.forEach((id, i) => {
      const win = sessionWindow(id);
      if (win.isMinimized()) win.restore();
      if (win.isMaximized()) win.unmaximize();
      placeWindow(win, rects[i]);
    });
    return before;
  }

  function restoreSessions(placements) {
    for (const [id, { bounds, maximized, minimized }] of Object.entries(placements)) {
      const win = sessionWindow(id);
      if (!win || win.isFullScreen()) continue;
      if (win.isMinimized()) win.restore();
      if (win.isMaximized()) win.unmaximize();
      if (!maximized && !minimized) {
        placeWindow(win, bounds);
        continue;
      }
      // placeWindow settles asynchronously and would undo the maximise, so
      // these only get their normal bounds back for when they are restored.
      win.setBounds(bounds);
      if (maximized) win.maximize();
      if (minimized) win.minimize();
    }
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

  function isSessionFocused(id) {
    return sessionWindow(id)?.isFocused() === true;
  }

  // Taskbar flash until the window is next focused.
  function flashSession(id) {
    const win = sessionWindow(id);
    if (!win || win.isFocused()) return;
    win.flashFrame(true);
    win.once("focus", () => win.flashFrame(false));
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
    sessionChrome,
    setSessionTitle,
    moveSession,
    sendToSession,
    sendToBridge,
    focusSession,
    centerSession,
    bringSessionHere,
    captureSessions,
    tileSessions,
    restoreSessions,
    closeSessionWindow,
    isSessionFocused,
    flashSession,
    pinSession,
    lockSession,
    controlWindow,
  };
}
