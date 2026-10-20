// Hyprland decides where every window goes and tells the client nothing: on
// Wayland a window cannot move itself, and Electron's getBounds reports what
// was asked for, not what the compositor did. Under Hyprland the windows are
// read and placed through the compositor's control socket instead.

import net from "node:net";
import path from "node:path";
import { parseAccelerator } from "./accelerator.js";

// Moves and resizes raise no socket event, so the window list is polled.
const POLL_MS = 1000;

const ADDRESS = /^0x[0-9a-f]+$/i;
const HEX_COLOUR = /^#([0-9a-f]{6})$/i;

export function socketPath(env) {
  const signature = env.HYPRLAND_INSTANCE_SIGNATURE;
  if (!signature || !env.XDG_RUNTIME_DIR) return null;
  return path.join(env.XDG_RUNTIME_DIR, "hypr", signature, ".socket.sock");
}

// Monitors in the same shape as Electron's displays. Hyprland lays monitors
// out in logical pixels but reports their modes in physical ones; `reserved`
// is what bars such as Waybar hold back, as [left, top, right, bottom].
export function displaysFrom(monitors) {
  const active = monitors.filter((monitor) => !monitor.disabled);
  const primaryId = Math.min(...active.map((monitor) => monitor.id));
  return active.map((monitor) => {
    const rotated = monitor.transform % 2 === 1;
    const width = Math.round((rotated ? monitor.height : monitor.width) / monitor.scale);
    const height = Math.round((rotated ? monitor.width : monitor.height) / monitor.scale);
    const [left, top, right, bottom] = monitor.reserved ?? [0, 0, 0, 0];
    return {
      id: monitor.id,
      label: monitor.description || monitor.name,
      primary: monitor.id === primaryId,
      bounds: { x: monitor.x, y: monitor.y, width, height },
      workArea: { x: monitor.x + left, y: monitor.y + top, width: width - left - right, height: height - top - bottom },
      scaleFactor: monitor.scale,
    };
  });
}

// Every Hekaton window belongs to the one main process and shares one class,
// so a window is known by the title it opened with.
export function windowsFrom(clients, pid) {
  return new Map(
    clients
      .filter((client) => client.pid === pid && client.mapped !== false)
      .map((client) => [
        client.initialTitle,
        {
          address: client.address,
          bounds: { x: client.at[0], y: client.at[1], width: client.size[0], height: client.size[1] },
          floating: client.floating,
          pinned: client.pinned,
          fullscreen: client.fullscreen > 0,
        },
      ]),
  );
}

function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(width, 0) * Math.max(height, 0);
}

// The display a rectangle sits on most, as Electron's screen.getDisplayMatching.
export function displayMatching(displays, rect) {
  let best = displays.find((display) => display.primary) ?? displays[0];
  let bestArea = 0;
  for (const display of displays) {
    const area = overlap(display.bounds, rect);
    if (area > bestArea) [best, bestArea] = [display, area];
  }
  return best;
}

function target(address) {
  if (!ADDRESS.test(address)) throw new Error(`Not a Hyprland window address: ${address}`);
  return `window = "address:${address}"`;
}

// Only a floating window can be placed. Resizing re-centres it, so the move
// comes last.
export function placeCommands(address, { x, y, width, height }) {
  const window = target(address);
  return [
    `hl.dsp.window.float({ action = "enable", ${window} })`,
    `hl.dsp.window.resize({ x = ${Math.round(width)}, y = ${Math.round(height)}, ${window} })`,
    `hl.dsp.window.move({ x = ${Math.round(x)}, y = ${Math.round(y)}, ${window} })`,
  ];
}

export function tileCommands(address) {
  return [`hl.dsp.window.float({ action = "disable", ${target(address)} })`];
}

// Hyprland only pins a floating window.
export function pinCommands(address, pinned) {
  const window = target(address);
  if (!pinned) return [`hl.dsp.window.pin({ action = "disable", ${window} })`];
  return [
    `hl.dsp.window.float({ action = "enable", ${window} })`,
    `hl.dsp.window.pin({ action = "enable", ${window} })`,
  ];
}

export function borderCommands(address, colour) {
  const hex = HEX_COLOUR.exec(colour ?? "")?.[1];
  if (!hex) return [];
  return [`hl.dsp.window.set_prop({ ${target(address)}, prop = "active_border_color", value = "rgb(${hex})" })`];
}

// Dispatchers go in one batch, separated by semicolons, which none of the
// commands above contain.
export function batch(commands) {
  return `[[BATCH]]${commands.map((command) => `dispatch ${command}`).join(";")}`;
}

// An Electron accelerator ("Control+Alt+H") in Hyprland's bind syntax
// ("CTRL + ALT + H"), or null for one it cannot express.
export function hyprlandKeys(accelerator) {
  const parsed = parseAccelerator(accelerator);
  return parsed ? [...parsed.modifiers.map((modifier) => modifier.toUpperCase()), parsed.key].join(" + ") : null;
}

function luaString(text) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function bindCode(keys, command) {
  return `hl.bind(${luaString(keys)}, hl.dsp.exec_cmd(${luaString(command)}))`;
}

export function unbindCode(keys) {
  return `hl.unbind(${luaString(keys)})`;
}

// `onChange` fires whenever a window or monitor differs from the last poll.
// Returns null outside Hyprland.
export function createHyprland({ env = process.env, pid = process.pid, onChange = () => {} } = {}) {
  const socket = socketPath(env);
  if (!socket) return null;
  let displays = [];
  let windows = new Map();
  let signature = "";
  let polling = null;

  function request(command) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const connection = net.createConnection(socket);
      connection.on("connect", () => connection.write(command));
      connection.on("data", (chunk) => chunks.push(chunk));
      connection.on("end", () => resolve(Buffer.concat(chunks).toString()));
      connection.on("error", reject);
    });
  }

  async function refresh() {
    const [clients, monitors] = await Promise.all([request("j/clients"), request("j/monitors")]);
    const next = JSON.stringify([clients, monitors]);
    if (next === signature) return;
    signature = next;
    displays = displaysFrom(JSON.parse(monitors));
    windows = windowsFrom(JSON.parse(clients), pid);
    onChange();
  }

  function refreshQuietly() {
    refresh().catch((error) => console.error(`hyprland: ${error.message}`));
  }

  async function dispatch(commands) {
    if (commands.length === 0) return;
    const reply = await request(batch(commands));
    const failures = reply.split(/\n+/).filter((line) => line.trim() && line.trim() !== "ok");
    if (failures.length > 0) console.error(`hyprland: ${failures.join("; ")}`);
    await refresh();
  }

  // Acts on the window opened with `title`, once Hyprland has mapped it.
  function act(title, build) {
    const address = windows.get(title)?.address;
    if (address) dispatch(build(address)).catch((error) => console.error(`hyprland: ${error.message}`));
  }

  async function evaluate(code) {
    const reply = (await request(`eval ${code}`)).trim();
    if (reply !== "ok") throw new Error(reply);
  }

  // Wayland gives no client a global shortcut, so Hyprland binds the keys to
  // run `command` instead. The binding outlives Hekaton, so the keys also
  // start it; any binding left by an earlier run is replaced, not doubled.
  // False for an accelerator Hyprland cannot express.
  let hotkey = null;
  function setHotkey(accelerator, command) {
    const keys = accelerator ? hyprlandKeys(accelerator) : null;
    if (accelerator && !keys) return false;
    const previous = hotkey;
    hotkey = keys;
    (async () => {
      if (previous && previous !== keys) await evaluate(unbindCode(previous));
      if (!keys) return;
      await evaluate(unbindCode(keys));
      await evaluate(bindCode(keys, command));
    })().catch((error) => console.error(`hyprland: ${error.message}`));
    return true;
  }

  return {
    name: "hyprland",
    start() {
      if (polling) return;
      refreshQuietly();
      polling = setInterval(refreshQuietly, POLL_MS);
    },
    refresh: refreshQuietly,
    displays: () => displays,
    window: (title) => windows.get(title) ?? null,
    place: (title, rect) => act(title, (address) => placeCommands(address, rect)),
    tile: (title) => act(title, tileCommands),
    pin: (title, pinned) => act(title, (address) => pinCommands(address, pinned)),
    border: (title, colour) => act(title, (address) => borderCommands(address, colour)),
    // Hyprland honours a client asking for focus, so Electron's is enough.
    focus: () => {},
    setHotkey,
  };
}
