// Sway, like Hyprland, places every window itself and tells the client
// nothing (see hyprland.js). Under Sway the windows are read and placed
// through its i3-compatible IPC socket instead. Sway has no per-window
// border colour, so the profile accent stays in the page there.

import net from "node:net";
import { parseAccelerator } from "./accelerator.js";

// Moves and resizes are polled, as under Hyprland, rather than subscribed to.
const POLL_MS = 1000;
const SETTLE_MS = 150;
const PLACE_ATTEMPTS = 4;

function closeTo(bounds, rect) {
  return bounds !== undefined && ["x", "y", "width", "height"].every((key) => Math.abs(bounds[key] - rect[key]) <= 1);
}

const MAGIC = "i3-ipc";
const HEADER_BYTES = MAGIC.length + 8;
const RUN_COMMAND = 0;
const GET_WORKSPACES = 1;
const GET_OUTPUTS = 3;
const GET_TREE = 4;

export function encode(type, payload = "") {
  const body = Buffer.from(payload);
  const header = Buffer.alloc(HEADER_BYTES);
  header.write(MAGIC);
  header.writeUInt32LE(body.length, MAGIC.length);
  header.writeUInt32LE(type, MAGIC.length + 4);
  return Buffer.concat([header, body]);
}

// The reply's JSON once `buffer` holds all of it, else null.
export function decode(buffer) {
  if (buffer.length < HEADER_BYTES) return null;
  const length = buffer.readUInt32LE(MAGIC.length);
  if (buffer.length < HEADER_BYTES + length) return null;
  return JSON.parse(buffer.subarray(HEADER_BYTES, HEADER_BYTES + length).toString());
}

// Outputs in the same shape as Electron's displays. Sway reports outputs in
// logical pixels already; the work area is the visible workspace, which
// leaves out what bars such as swaybar hold back.
export function displaysFrom(outputs, workspaces) {
  const active = outputs.filter((output) => output.active);
  return active.map((output, index) => {
    const workspace = workspaces.find((candidate) => candidate.output === output.name && candidate.visible);
    return {
      id: output.name,
      label: [output.make, output.model].filter((part) => part && part !== "Unknown").join(" ") || output.name,
      primary: index === 0,
      bounds: { ...output.rect },
      workArea: { ...(workspace?.rect ?? output.rect) },
      scaleFactor: output.scale ?? 1,
    };
  });
}

// This process's windows in the layout tree, by container id. A container's
// rect includes its border, and so does what `placeCommand` sets.
export function windowsFrom(tree, pid) {
  const windows = new Map();
  const walk = (node, floating) => {
    if (node.pid === pid) {
      windows.set(node.id, {
        id: node.id,
        title: node.name,
        bounds: { ...node.rect },
        floating,
        pinned: node.sticky === true,
        fullscreen: node.fullscreen_mode > 0,
      });
    }
    for (const child of node.nodes ?? []) walk(child, floating);
    for (const child of node.floating_nodes ?? []) walk(child, true);
  };
  walk(tree, false);
  return windows;
}

function target(id) {
  if (!Number.isInteger(id)) throw new Error(`Not a Sway container id: ${id}`);
  return `[con_id=${id}]`;
}

export function placeCommand(id, { x, y, width, height }) {
  return (
    `${target(id)} floating enable, ` +
    `resize set width ${Math.round(width)} px height ${Math.round(height)} px, ` +
    `move absolute position ${Math.round(x)} px ${Math.round(y)} px`
  );
}

export function tileCommand(id) {
  return `${target(id)} floating disable`;
}

// Sway's sticky keeps a floating window on screen across workspaces, which
// is the nearest it has to always-on-top.
export function pinCommand(id, pinned) {
  return pinned ? `${target(id)} floating enable, sticky enable` : `${target(id)} sticky disable`;
}

const SWAY_MODIFIERS = { ctrl: "Ctrl", alt: "Mod1", shift: "Shift", super: "Mod4" };

// An Electron accelerator ("Control+Alt+H") in Sway's bindsym syntax
// ("Ctrl+Mod1+h"), or null for one it cannot express. Letters are lower
// case: an upper-case keysym would need Shift.
export function swayKeys(accelerator) {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return null;
  const key = parsed.character ? parsed.key.toLowerCase() : parsed.key;
  return [...parsed.modifiers.map((modifier) => SWAY_MODIFIERS[modifier]), key].join("+");
}

// `onChange` fires whenever a window or output differs from the last poll.
// Returns null outside Sway.
export function createSway({ env = process.env, pid = process.pid, onChange = () => {} } = {}) {
  const socket = env.SWAYSOCK;
  if (!socket) return null;
  let displays = [];
  let windows = new Map();
  let signature = "";
  let polling = null;
  // A window is known by the title it opened with, which only lasts until
  // Hekaton retitles it, so the container id is remembered on first sight.
  const containers = new Map();

  function request(type, payload) {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const connection = net.createConnection(socket);
      connection.on("connect", () => connection.write(encode(type, payload)));
      connection.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const reply = decode(buffer);
        if (reply === null) return;
        connection.end();
        resolve(reply);
      });
      connection.on("error", reject);
    });
  }

  async function refresh() {
    const [tree, outputs, workspaces] = await Promise.all([
      request(GET_TREE),
      request(GET_OUTPUTS),
      request(GET_WORKSPACES),
    ]);
    const nextWindows = windowsFrom(tree, pid);
    const nextDisplays = displaysFrom(outputs, workspaces);
    const next = JSON.stringify([[...nextWindows.values()], nextDisplays]);
    if (next === signature) return;
    signature = next;
    windows = nextWindows;
    displays = nextDisplays;
    onChange();
  }

  function refreshQuietly() {
    refresh().catch((error) => console.error(`sway: ${error.message}`));
  }

  // Commands go to Sway one at a time, in the order they were asked for.
  let queue = Promise.resolve();
  function run(command) {
    const sent = queue.then(async () => {
      const replies = await request(RUN_COMMAND, command);
      const failures = replies.filter((reply) => !reply.success).map((reply) => reply.error);
      if (failures.length > 0) throw new Error(failures.join("; "));
    });
    queue = sent.catch(() => {});
    return sent;
  }

  function lookup(title) {
    const known = windows.get(containers.get(title));
    if (known) return known;
    const found = [...windows.values()].find((candidate) => candidate.title === title);
    if (found) containers.set(title, found.id);
    return found ?? null;
  }

  // Acts on the window opened with `title`, once Sway has mapped it.
  function act(title, build) {
    const id = lookup(title)?.id;
    if (id === undefined) return;
    run(build(id))
      .then(refresh)
      .catch((error) => console.error(`sway: ${error.message}`));
  }

  // Floating one window makes Sway reflow the others while their clients are
  // still answering earlier resizes, and a floating client's late answer
  // wins, so a placement is checked and sent again until it holds.
  async function placeUntilSettled(title, rect) {
    for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt += 1) {
      const id = lookup(title)?.id;
      if (id === undefined) return;
      await run(placeCommand(id, rect));
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      await refresh();
      if (closeTo(windows.get(id)?.bounds, rect)) return;
    }
  }

  function place(title, rect) {
    placeUntilSettled(title, rect).catch((error) => console.error(`sway: ${error.message}`));
  }

  // As under Hyprland: Sway binds the keys to run `command`, the binding
  // outlives Hekaton, and a new bindsym replaces one left by an earlier run.
  let hotkey = null;
  function setHotkey(accelerator, command) {
    const keys = accelerator ? swayKeys(accelerator) : null;
    if (accelerator && !keys) return false;
    const previous = hotkey;
    hotkey = keys;
    (async () => {
      if (previous && previous !== keys) await run(`unbindsym ${previous}`);
      if (keys) await run(`bindsym ${keys} exec ${command}`);
    })().catch((error) => console.error(`sway: ${error.message}`));
    return true;
  }

  return {
    name: "sway",
    start() {
      if (polling) return;
      refreshQuietly();
      polling = setInterval(refreshQuietly, POLL_MS);
    },
    refresh: refreshQuietly,
    displays: () => displays,
    window: lookup,
    place,
    tile: (title) => act(title, tileCommand),
    pin: (title, pinned) => act(title, (id) => pinCommand(id, pinned)),
    // Sway ignores a client asking for focus, so the compositor gives it.
    focus: (title) => act(title, (id) => `${target(id)} focus`),
    border: () => {},
    setHotkey,
  };
}
