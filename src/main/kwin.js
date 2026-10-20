// KDE Plasma's KWin, like Hyprland and Sway, places every window itself on
// Wayland and tells the client nothing (see hyprland.js). It is driven by
// KWin scripts loaded over D-Bus: a long-lived one reports this process's
// windows and the screens whenever they change, and registers the hotkey;
// short ones carry out each placement. The scripts answer by calling back
// into this process over D-Bus.
//
// Unlike the tiling compositors, KWin floats windows, honours their minimum
// size and draws no frame for a frameless one, so Hekaton keeps its minimums,
// caption buttons and accent frame here. KWin cannot colour one window's
// border.

import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import dbus from "dbus-native";
import { parseAccelerator } from "./accelerator.js";

const OBJECT_PATH = "/io/github/philbartlett/Hekaton";
const INTERFACE = "io.github.philbartlett.Hekaton";
const WATCHER = "hekaton-watcher";

export function isKde(env) {
  const desktops = String(env.XDG_CURRENT_DESKTOP ?? "").split(":");
  return Boolean(env.WAYLAND_DISPLAY) && desktops.includes("KDE");
}

// Each instance owns a bus name of its own for the scripts to call back on.
export function busName(pid) {
  return `${INTERFACE}.p${pid}`;
}

// Qt's names for the keys parseAccelerator gives as xkb keysyms.
const QT_KEYS = {
  space: "Space",
  Return: "Return",
  Tab: "Tab",
  Escape: "Esc",
  BackSpace: "Backspace",
  Delete: "Del",
  Home: "Home",
  End: "End",
  Prior: "PgUp",
  Next: "PgDown",
  Up: "Up",
  Down: "Down",
  Left: "Left",
  Right: "Right",
};
const QT_MODIFIERS = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", super: "Meta" };

// An Electron accelerator ("Control+Alt+H") as a Qt key sequence
// ("Ctrl+Alt+H"), or null for one it cannot express.
export function qtKeys(accelerator) {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return null;
  const key = parsed.character || /^F\d+$/.test(parsed.key) ? parsed.key : QT_KEYS[parsed.key];
  return key ? [...parsed.modifiers.map((modifier) => QT_MODIFIERS[modifier]), key].join("+") : null;
}

// Values go into a script as JSON literals, which are valid JavaScript.
const literal = (value) => JSON.stringify(value);

function callback(destination, member, argument) {
  const args = argument === undefined ? "" : `, ${argument}`;
  return `callDBus(${literal(destination)}, ${literal(OBJECT_PATH)}, ${literal(INTERFACE)}, ${literal(member)}${args})`;
}

// The long-lived script. It reports on every change to one of this
// process's windows or to the screens. KDE keeps the first keys it saw for a
// shortcut name, so the name carries the keys and a new hotkey is a new
// shortcut.
export function watcherScript({ destination, pid, keys }) {
  return `const PID = ${literal(pid)};
function rect(r) { return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }
function snapshot() {
  const windows = workspace.windowList().filter((w) => w.pid === PID).map((w) => ({
    id: String(w.internalId), title: w.caption, bounds: rect(w.frameGeometry),
    pinned: w.keepAbove, fullscreen: w.fullScreen, minimized: w.minimized,
  }));
  const screens = workspace.screens.map((s) => ({
    name: s.name, manufacturer: s.manufacturer, model: s.model, scale: s.devicePixelRatio,
    bounds: rect(s.geometry), workArea: rect(workspace.clientArea(KWin.MaximizeArea, s, workspace.currentDesktop)),
  }));
  return JSON.stringify({ windows, screens });
}
function report() { ${callback(destination, "Report", "snapshot()")}; }
const SIGNALS = ["frameGeometryChanged", "captionChanged", "keepAboveChanged", "fullScreenChanged", "minimizedChanged"];
function watch(w) {
  if (w.pid !== PID) return;
  for (const name of SIGNALS) if (w[name]) w[name].connect(report);
}
workspace.windowList().forEach(watch);
workspace.windowAdded.connect((w) => { watch(w); report(); });
workspace.windowRemoved.connect(report);
if (workspace.screensChanged) workspace.screensChanged.connect(report);
${
  keys
    ? `registerShortcut(${literal(`Hekaton: raise the Bridge (${keys})`)}, "Raise the Hekaton Bridge", ${literal(keys)}, () => { ${callback(destination, "RaiseBridge")}; });`
    : ""
}
report();
`;
}

// Runs `statement` on the window with KWin id `id`, if it is still there,
// in a scope of its own.
function onWindow(id, statement) {
  return `(() => {
  const w = workspace.windowList().find((candidate) => String(candidate.internalId) === ${literal(id)});
  if (w) ${statement};
})();
`;
}

export function placeScript(id, { x, y, width, height }) {
  const geometry = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  return onWindow(id, `w.frameGeometry = ${literal(geometry)}`);
}

export function pinScript(id, pinned) {
  return onWindow(id, `w.keepAbove = ${literal(pinned)}`);
}

// KWin ignores a client asking for focus; it gives it itself.
export function focusScript(id) {
  return onWindow(id, "workspace.activeWindow = w");
}

// A report in the shapes the window manager uses: Electron-style displays,
// and this process's windows by KWin id. KWin floats every window.
export function readReport(json) {
  const { windows, screens } = JSON.parse(json);
  return {
    displays: screens.map((screen, index) => ({
      id: screen.name,
      label: [screen.manufacturer, screen.model].filter(Boolean).join(" ") || screen.name,
      primary: index === 0,
      bounds: screen.bounds,
      workArea: screen.workArea,
      scaleFactor: screen.scale ?? 1,
    })),
    windows: new Map(
      windows.map((window) => [
        window.id,
        { ...window, floating: true, pinned: window.pinned === true, fullscreen: window.fullscreen === true },
      ]),
    ),
  };
}

// `onChange` fires whenever a window or screen differs from the last report,
// `onHotkey` when the registered hotkey is pressed. Returns null outside KDE.
export function createKWin({ env = process.env, pid = process.pid, onChange = () => {}, onHotkey = () => {} } = {}) {
  if (!isKde(env)) return null;
  const destination = busName(pid);
  const scriptDir = path.join(os.tmpdir(), `hekaton-kwin-${pid}`);
  let bus = null;
  let ready = null;
  let displays = [];
  let windows = new Map();
  let signature = "";
  let keys = null;
  let serial = 0;
  // A window is known by the title it opened with, which only lasts until
  // Hekaton retitles it, so its KWin id is remembered on first sight.
  const ids = new Map();

  function kwin(objectPath, iface, member, types = "", body = []) {
    return bus.invoke({
      destination: "org.kde.KWin",
      path: objectPath,
      interface: iface,
      member,
      signature: types,
      body,
    });
  }

  // Loads, runs and (for a one-off) unloads a script; KWin reads it from a file.
  async function runScript(name, source, { keep = false } = {}) {
    const file = path.join(scriptDir, `${name}.js`);
    writeFileSync(file, source);
    await kwin("/Scripting", "org.kde.kwin.Scripting", "unloadScript", "s", [name]);
    const id = await kwin("/Scripting", "org.kde.kwin.Scripting", "loadScript", "ss", [file, name]);
    await kwin(`/Scripting/Script${id}`, "org.kde.kwin.Script", "run");
    if (keep) return;
    await kwin("/Scripting", "org.kde.kwin.Scripting", "unloadScript", "s", [name]);
    unlinkSync(file);
  }

  function received(json) {
    if (json === signature) return;
    signature = json;
    ({ displays, windows } = readReport(json));
    onChange();
  }

  async function connect() {
    mkdirSync(scriptDir, { recursive: true });
    bus = dbus.sessionBus();
    await bus.requestName(destination, 0);
    bus.exportInterface({ Report: received, RaiseBridge: () => onHotkey() }, OBJECT_PATH, {
      name: INTERFACE,
      methods: { Report: ["s", ""], RaiseBridge: ["", ""] },
    });
    await runScript(WATCHER, watcherScript({ destination, pid, keys }), { keep: true });
  }

  function start() {
    ready ??= connect().catch((error) => console.error(`kwin: ${error.message}`));
    return ready;
  }

  function lookup(title) {
    const known = windows.get(ids.get(title));
    if (known) return known;
    const found = [...windows.values()].find((candidate) => candidate.title === title);
    if (found) ids.set(title, found.id);
    return found ?? null;
  }

  function act(title, build) {
    const id = lookup(title)?.id;
    if (id === undefined) return;
    serial += 1;
    start()
      .then(() => runScript(`hekaton-act-${serial}`, build(id)))
      .catch((error) => console.error(`kwin: ${error.message}`));
  }

  // The watcher carries the shortcut, so a new hotkey reloads it.
  function setHotkey(accelerator) {
    const next = accelerator ? qtKeys(accelerator) : null;
    if (accelerator && !next) return false;
    keys = next;
    start()
      .then(() => runScript(WATCHER, watcherScript({ destination, pid, keys }), { keep: true }))
      .catch((error) => console.error(`kwin: ${error.message}`));
    return true;
  }

  return {
    name: "kwin",
    tiling: false,
    start,
    // The watcher reports changes itself.
    refresh: () => {},
    displays: () => displays,
    window: lookup,
    place: (title, rect) => act(title, (id) => placeScript(id, rect)),
    // KWin floats every window, so there is no tiling to hand one back to.
    tile: () => {},
    pin: (title, pinned) => act(title, (id) => pinScript(id, pinned)),
    focus: (title) => act(title, focusScript),
    border: () => {},
    setHotkey,
  };
}
