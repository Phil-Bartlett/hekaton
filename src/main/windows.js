import { BrowserWindow, dialog, screen } from "electron";
import path from "node:path";
import { CH } from "../shared/channels.js";
import { createHyprland, displayMatching } from "./hyprland.js";
import { MIN_HEIGHT, MIN_WIDTH } from "./placement.js";
import { IS_WINDOWS, titleBarOptions } from "./platform.js";
import { tileRects } from "./tiling.js";

// The main bundle lives at dist/main.cjs, so __dirname is dist/.
const PRELOAD = path.join(__dirname, "preload.cjs");
const RENDERER_DIR = path.join(__dirname, "renderer");

const TITLE_BAR_HEIGHT = 36;
const BACKGROUND = "#1a1a1a";
const BRIDGE_TITLE = "Hekaton";

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

function electronDisplays() {
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

function throttled(fn) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, BOUNDS_THROTTLE_MS);
  };
}

function sameBounds(a, b) {
  return ["x", "y", "width", "height"].every((key) => a?.[key] === b?.[key]);
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

  // Under Hyprland every window is read and placed through the compositor.
  // A session window opens under a title naming its session, so the
  // compositor's record of it can be found, and takes its real title once
  // that record has been seen.
  const hyprland = createHyprland({ onChange: () => hyprlandChanged() });
  const openingTitles = new Map();
  const hyprlandSessions = new Map();
  let lastBridgeBounds = null;

  function hyprlandChanged() {
    for (const [id, entry] of hyprlandSessions) {
      const state = hyprland.window(entry.openingTitle);
      const win = sessionWindow(id);
      if (!state || !win) continue;
      if (!entry.seen) {
        entry.seen = true;
        win.setTitle(entry.title);
        if (entry.accent) hyprland.border(entry.openingTitle, entry.accent);
        if (chromeFor(win).pinned) hyprland.pin(entry.openingTitle, true);
      }
      if (!sameBounds(state.bounds, entry.bounds)) {
        entry.bounds = state.bounds;
        onSessionBounds(id);
      }
    }
    const bridgeBounds = hyprland.window(BRIDGE_TITLE)?.bounds;
    if (bridgeBounds && !sameBounds(bridgeBounds, lastBridgeBounds)) {
      lastBridgeBounds = bridgeBounds;
      onBridgeBounds(bridgeBounds);
    }
  }

  function listDisplays() {
    const fromHyprland = hyprland?.displays() ?? [];
    return fromHyprland.length > 0 ? fromHyprland : electronDisplays();
  }

  function displayFor(rect) {
    return hyprland ? displayMatching(listDisplays(), rect) : screen.getDisplayMatching(rect);
  }

  function primaryDisplay() {
    return hyprland ? listDisplays().find((display) => display.primary) : screen.getPrimaryDisplay();
  }

  // Saved bounds are only trusted when a decent slice of the window would
  // still land on a connected display; a monitor may have gone since.
  function boundsOnScreen(bounds) {
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.width)) return null;
    const visible = listDisplays().some(({ workArea }) => {
      const w = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
      const h = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
      return w >= MIN_VISIBLE_PX && h >= MIN_VISIBLE_PX;
    });
    return visible ? bounds : null;
  }

  // Electron's own bounds are what was last asked for under Hyprland, so the
  // compositor's are used there; null until it has mapped the window.
  function boundsOf(win) {
    return hyprland ? (hyprland.window(openingTitles.get(win.id))?.bounds ?? null) : win.getBounds();
  }

  function hyprlandState(win) {
    return hyprland?.window(openingTitles.get(win.id)) ?? null;
  }

  function isFullScreen(win) {
    return hyprland ? hyprlandState(win)?.fullscreen === true : win.isFullScreen();
  }

  // Hyprland sizes windows without regard to their minimum, and Electron then
  // lays the page out at the minimum and lets the compositor crop it, so
  // there the page has to fit whatever it is given.
  function minimumSize(width, height) {
    return hyprland ? {} : { minWidth: width, minHeight: height };
  }

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
    win.on("closed", () => {
      chromeState.delete(win.id);
      openingTitles.delete(win.id);
    });
  }

  function createBridgeWindow(savedBounds) {
    if (bridge && !bridge.isDestroyed()) {
      showBridge();
      return bridge;
    }
    hyprland?.start();
    bridge = new BrowserWindow({
      ...(boundsOnScreen(savedBounds) ?? { width: 1180, height: 830 }),
      ...minimumSize(720, 480),
      backgroundColor: BACKGROUND,
      title: BRIDGE_TITLE,
      ...titleBarOptions({ height: TITLE_BAR_HEIGHT }),
      webPreferences: webPreferences(["--hekaton-window=bridge"]),
    });
    openingTitles.set(bridge.id, BRIDGE_TITLE);
    bridge.on("page-title-updated", (event) => event.preventDefault());
    bridge.on("closed", () => {
      bridge = null;
    });
    const bridgeMoved = throttled(() => {
      if (!bridge || bridge.isDestroyed()) return;
      if (hyprland) hyprland.refresh();
      else if (!bridge.isMinimized()) onBridgeBounds(bridge.getBounds());
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
      if (win.isDestroyed()) return;
      if (hyprland) hyprland.refresh();
      else if (!win.isMinimized()) onSessionBounds(id);
    });
    win.on("move", changed);
    win.on("resize", changed);
  }

  function createSessionWindow(session, bounds, { pinned = false } = {}) {
    hyprland?.start();
    const openingTitle = hyprland ? `Hekaton session ${session.id}` : session.profile.name;
    const win = new BrowserWindow({
      ...bounds,
      ...minimumSize(MIN_WIDTH, MIN_HEIGHT),
      backgroundColor: BACKGROUND,
      title: openingTitle,
      // Square corners so the accent frame meets at the corners on Windows 11.
      ...(IS_WINDOWS && { roundedCorners: false }),
      ...titleBarOptions({ height: TITLE_BAR_HEIGHT }),
      webPreferences: webPreferences(["--hekaton-window=session", `--hekaton-instance=${session.id}`]),
    });
    sessionWindows.set(session.id, win);
    openingTitles.set(win.id, openingTitle);
    if (hyprland) {
      const colourScope = session.profile.colorScope ?? "border+title";
      hyprlandSessions.set(session.id, {
        openingTitle,
        title: session.profile.name,
        accent: colourScope.includes("border") ? session.profile.accent : null,
        seen: false,
        bounds: null,
      });
    }
    win.on("closed", () => {
      sessionWindows.delete(session.id);
      hyprlandSessions.delete(session.id);
    });
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
      // Hyprland pins the window once it has been mapped.
      if (!hyprland) win.setAlwaysOnTop(true);
      chromeFor(win).pinned = true;
    }
    forwardConsole(win, session.profile.name);
    win.loadFile(path.join(RENDERER_DIR, "session", "index.html"));
    return win;
  }

  function sessionBounds(id) {
    const win = sessionWindow(id);
    if (!win || (!hyprland && win.isMinimized())) return null;
    return boundsOf(win);
  }

  function sessionChrome(id) {
    const win = sessionWindow(id);
    return win ? chromeFor(win) : null;
  }

  // OS-level title: the profile, plus Claude's own name for the conversation
  // once it has one, so Alt+Tab and the taskbar tell sessions apart.
  function setSessionTitle(id, title) {
    const win = sessionWindow(id);
    if (!win) return;
    const entry = hyprlandSessions.get(id);
    if (entry) entry.title = title;
    if (entry && !entry.seen) return;
    if (win.getTitle() !== title) win.setTitle(title);
  }

  function moveSession(id, x, y) {
    const win = sessionWindow(id);
    const current = win && boundsOf(win);
    if (!current || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const { width, height } = current;
    const display = displayFor({ x: Math.round(x), y: Math.round(y), width, height });
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
    if (hyprland) {
      hyprland.place(openingTitles.get(win.id), target);
      return;
    }
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
    const current = boundsOf(win);
    if (!current || !display) return;
    const area = display.workArea;
    const width = Math.min(current.width, area.width);
    const height = Math.min(current.height, area.height);
    const wanted = position ?? { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2 };
    const x = Math.round(Math.min(Math.max(wanted.x, area.x), area.x + area.width - width));
    const y = Math.round(Math.min(Math.max(wanted.y, area.y), area.y + area.height - height));
    placeWindow(win, { x, y, width, height });
  }

  // Where each window is now, in a form restoreSessions can put back. Under
  // Hyprland that includes whether the compositor was tiling it.
  function captureSessions(ids) {
    const placements = {};
    for (const id of ids) {
      const win = sessionWindow(id);
      if (!win) continue;
      if (hyprland) {
        const state = hyprlandState(win);
        if (state)
          placements[id] = { bounds: state.bounds, maximized: false, minimized: false, floating: state.floating };
        continue;
      }
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
    const bridgeBounds = bridge && !bridge.isDestroyed() ? boundsOf(bridge) : null;
    const display =
      listDisplays().find((candidate) => String(candidate.id) === String(displayId)) ??
      (bridgeBounds ? displayFor(bridgeBounds) : primaryDisplay());
    const tiled = ids.filter(
      (id) => sessionWindow(id) && boundsOf(sessionWindow(id)) && !isFullScreen(sessionWindow(id)),
    );
    const before = captureSessions(tiled);
    const rects = tileRects(tiled.length, display.workArea, options);
    tiled.forEach((id, i) => {
      const win = sessionWindow(id);
      if (!hyprland) {
        if (win.isMinimized()) win.restore();
        if (win.isMaximized()) win.unmaximize();
      }
      placeWindow(win, rects[i]);
    });
    return before;
  }

  function restoreSessions(placements) {
    for (const [id, { bounds, maximized, minimized, floating }] of Object.entries(placements)) {
      const win = sessionWindow(id);
      if (!win || isFullScreen(win)) continue;
      if (hyprland) {
        if (floating === false) hyprland.tile(openingTitles.get(win.id));
        else placeWindow(win, bounds);
        continue;
      }
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
    const current = win && boundsOf(win);
    if (!current) return;
    fitToDisplay(win, displayFor(current));
    focusSession(id);
  }

  // Move the session window onto whichever display the Bridge is on.
  function bringSessionHere(id) {
    const win = sessionWindow(id);
    if (!win) return;
    const bridgeBounds = bridge && !bridge.isDestroyed() ? boundsOf(bridge) : null;
    fitToDisplay(win, bridgeBounds ? displayFor(bridgeBounds) : primaryDisplay());
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
    if (hyprland) hyprland.pin(openingTitles.get(win.id), pinned);
    else win.setAlwaysOnTop(pinned);
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
    windowManager: hyprland ? "hyprland" : null,
    compositor: hyprland,
    listDisplays,
    boundsOnScreen,
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
