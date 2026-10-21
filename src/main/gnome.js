// GNOME, like the other Wayland compositors, places every window itself and
// tells the client nothing (see hyprland.js), and since GNOME 41 it lets no
// app run code in the shell. Hekaton's own Shell extension (gnome-extension/)
// does the placing instead: this process calls Watch on it over D-Bus, the
// extension calls back with this process's windows and the monitors whenever
// they change, in the same report KWin's scripts send (kwin.js), and it
// places, pins and focuses those windows on request.
//
// Mutter floats windows, honours minimum sizes and draws no frame for a
// frameless one, so as under KWin Hekaton keeps its caption buttons,
// minimums and accent frame. The hotkey is a GNOME custom shortcut that
// relaunches Hekaton, as under Hyprland.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dbus from "dbus-native";
import { parseAccelerator } from "./accelerator.js";
import { INTERFACE as CLIENT_INTERFACE, OBJECT_PATH as CLIENT_PATH, readReport } from "./kwin.js";

const SHELL_NAME = "io.github.philbartlett.HekatonShell";
const SHELL_PATH = "/io/github/philbartlett/HekatonShell";

const MEDIA_KEYS = "org.gnome.settings-daemon.plugins.media-keys";
const BINDING_LIST = "custom-keybindings";
export const BINDING_PATH = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/hekaton/";
const BINDING_SCHEMA = `${MEDIA_KEYS}.custom-keybinding:${BINDING_PATH}`;
const BINDING_NAME = "Raise the Hekaton Bridge";

const run = promisify(execFile);

export function isGnome(env) {
  const desktops = String(env.XDG_CURRENT_DESKTOP ?? "").split(":");
  return Boolean(env.WAYLAND_DISPLAY) && desktops.includes("GNOME");
}

const GTK_MODIFIERS = { ctrl: "<Control>", alt: "<Alt>", shift: "<Shift>", super: "<Super>" };

// An Electron accelerator ("Control+Alt+H") in GTK's accelerator syntax
// ("<Control><Alt>h"), or null for one it cannot express. Letters are lower
// case: an upper-case keysym would need Shift.
export function gnomeKeys(accelerator) {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return null;
  const key = parsed.character ? parsed.key.toLowerCase() : parsed.key;
  return parsed.modifiers.map((modifier) => GTK_MODIFIERS[modifier]).join("") + key;
}

// gsettings reads and writes values in GVariant's text format.
export function variantString(text) {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function parseStrv(text) {
  return [...text.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1].replace(/\\(.)/g, "$1"));
}

export function formatStrv(list) {
  return `[${list.map(variantString).join(", ")}]`;
}

// The gsettings calls that make `keys` run `command`, or with no keys remove
// the shortcut, given the current list of custom shortcuts. Hekaton's
// shortcut keeps one path of its own, so a new hotkey replaces the last.
export function hotkeyCommands(listText, keys, command) {
  const list = parseStrv(listText);
  const listed = list.includes(BINDING_PATH);
  if (!keys) {
    return [
      ...(listed
        ? [["set", MEDIA_KEYS, BINDING_LIST, formatStrv(list.filter((entry) => entry !== BINDING_PATH))]]
        : []),
      ...["name", "command", "binding"].map((key) => ["reset", BINDING_SCHEMA, key]),
    ];
  }
  return [
    ["set", BINDING_SCHEMA, "name", variantString(BINDING_NAME)],
    ["set", BINDING_SCHEMA, "command", variantString(command)],
    ["set", BINDING_SCHEMA, "binding", variantString(keys)],
    ...(listed ? [] : [["set", MEDIA_KEYS, BINDING_LIST, formatStrv([...list, BINDING_PATH])]]),
  ];
}

// `onChange` fires whenever a window or monitor differs from the last
// report. Returns null outside GNOME.
export function createGnome({ env = process.env, onChange = () => {} } = {}) {
  if (!isGnome(env)) return null;
  let bus = null;
  let ready = null;
  let displays = [];
  let windows = new Map();
  let signature = "";
  // A window is known by the title it opened with, which only lasts until
  // Hekaton retitles it, so its Mutter id is remembered on first sight.
  const ids = new Map();

  function shell(member, types = "", body = []) {
    return bus.invoke({
      destination: SHELL_NAME,
      path: SHELL_PATH,
      interface: SHELL_NAME,
      member,
      signature: types,
      body,
    });
  }

  function received(json) {
    if (json === signature) return;
    signature = json;
    ({ displays, windows } = readReport(json));
    onChange();
  }

  async function connect() {
    bus = dbus.sessionBus();
    bus.exportInterface({ Report: received }, CLIENT_PATH, {
      name: CLIENT_INTERFACE,
      methods: { Report: ["s", ""] },
    });
    await shell("Watch");
  }

  function start() {
    ready ??= connect().catch((error) => console.error(`gnome: ${error.message}`));
    return ready;
  }

  function lookup(title) {
    const known = windows.get(ids.get(title));
    if (known) return known;
    const found = [...windows.values()].find((candidate) => candidate.title === title);
    if (found) ids.set(title, found.id);
    return found ?? null;
  }

  function act(title, member, types, args) {
    const id = lookup(title)?.id;
    if (id === undefined) return;
    start()
      .then(() => shell(member, types, [id, ...args]))
      .catch((error) => console.error(`gnome: ${error.message}`));
  }

  // gsettings calls run one at a time, so a quick change of hotkey cannot
  // interleave with the one before.
  let hotkeyQueue = Promise.resolve();
  function setHotkey(accelerator, command) {
    const keys = accelerator ? gnomeKeys(accelerator) : null;
    if (accelerator && !keys) return false;
    hotkeyQueue = hotkeyQueue
      .then(async () => {
        const { stdout } = await run("gsettings", ["get", MEDIA_KEYS, BINDING_LIST]);
        for (const args of hotkeyCommands(stdout, keys, command)) await run("gsettings", args);
      })
      .catch((error) => console.error(`gnome: ${error.message}`));
    return true;
  }

  return {
    name: "gnome",
    tiling: false,
    start,
    // The extension reports changes itself.
    refresh: () => {},
    displays: () => displays,
    window: lookup,
    place: (title, { x, y, width, height }) =>
      act(
        title,
        "Place",
        "siiii",
        [x, y, width, height].map((value) => Math.round(value)),
      ),
    // Mutter floats every window, so there is no tiling to hand one back to.
    tile: () => {},
    pin: (title, pinned) => act(title, "Pin", "sb", [pinned]),
    focus: (title) => act(title, "Focus", "s", []),
    border: () => {},
    setHotkey,
  };
}
