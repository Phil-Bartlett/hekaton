// Records the computed style of every element the Bridge draws, across all
// its views and at three widths, so a CSS change can be proved to change
// only what it meant to. Two rules of equal specificity silently swap
// winners when files or rules are reordered; this is what catches it.
//
//   node scripts/style-check.mjs record <file.json>   (after npm run build)
//   node scripts/style-check.mjs compare <before.json> <after.json>
//
// `record` starts its own Hekaton against a fixed fixture in a temporary
// folder, with Claude's own folder pointed at an empty one, so nothing on
// this machine (live sessions, conversations, saved cards) reaches the page.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WIDTHS = [1180, 800, 640];
const HEIGHT = 830;
// Text that changes by itself (elapsed time) changes its element's size.
const LIVE_TEXT = /card__elapsed|history-entry__ago/;

const PROFILES = [
  { id: "style-a", name: "Alpha", accent: "#22c55e", colorScope: "border+title" },
  { id: "style-b", name: "Bravo", accent: "#3b82f6", colorScope: "border" },
  { id: "style-c", name: "Charlie", accent: "#f97316", colorScope: "title" },
];

function seed(dir) {
  rmSync(dir, { recursive: true, force: true });
  const work = path.join(dir, "work");
  mkdirSync(work, { recursive: true });
  mkdirSync(path.join(dir, "claude"));
  writeFileSync(
    path.join(dir, "profiles.json"),
    JSON.stringify(PROFILES.map((profile) => ({ ...profile, cwd: work }))),
  );
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ keepInTray: false }));
  const now = Date.now();
  const instances = PROFILES.map((profile, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index}`,
    profileId: profile.id,
    profileName: profile.name,
    accent: profile.accent,
    colorScope: profile.colorScope,
    cwd: work,
    claudeSessionId: `00000000-0000-4000-9000-00000000000${index}`,
    transcriptPath: null,
    title: index === 0 ? "Refactor the stylesheet" : null,
    model: null,
    firstPrompt: index === 0 ? "Split bridge.css by area and prove nothing moved" : null,
    lastPrompt: null,
    totalCostUsd: 0,
    startedAt: now,
    lastSeenAt: now,
    exitCode: null,
    host: os.hostname(),
    bounds: null,
    pinned: false,
    trayOpen: false,
    live: false,
  }));
  writeFileSync(path.join(dir, "state.json"), JSON.stringify({ version: 1, order: [], instances }));
}

function freePort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function bridgeTarget(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === "page" && target.url.includes("bridge/index"));
      if (page) return page;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The Bridge never opened");
}

function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) =>
        message.error ? reject(new Error(message.error.message)) : resolve(message.result),
      );
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? expression);
    return result.result.value;
  };
  return new Promise((resolve) => socket.addEventListener("open", () => resolve({ send, evaluate, socket })));
}

// Every element's computed style, hashed, keyed by its path through the DOM.
const SNAPSHOT = `(() => {
  const hash = (text) => { let h = 5381; for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) | 0; return h; };
  const pathOf = (el) => {
    const parts = [];
    for (; el && el !== document.documentElement; el = el.parentElement) {
      const classes = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).join(".") : "";
      parts.unshift(el.tagName.toLowerCase() + classes + ":" + [...el.parentNode.children].indexOf(el));
    }
    return parts.join(">");
  };
  const out = {};
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el);
    const props = [];
    for (let i = 0; i < style.length; i++) props.push(style[i] + ":" + style.getPropertyValue(style[i]));
    // Custom properties come back in a different order from launch to launch.
    out[pathOf(el)] = hash(props.sort().join(";"));
  }
  return out;
})()`;

async function walkViews({ send, evaluate }) {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const closeDialogs = () =>
    evaluate(
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.querySelectorAll(".dialog-backdrop").forEach((backdrop) => backdrop.click())`,
    );
  const setDensity = (density) =>
    evaluate(
      `window.hekaton.bridge.getState().then((s) => window.hekaton.bridge.saveSettings({ layout: { ...s.settings.layout, density: ${JSON.stringify(density)} } }))`,
    );
  const views = {};
  const record = async (name) => {
    await settle();
    views[name] = await evaluate(SNAPSHOT);
  };

  // Focus and the pointer change :focus and :hover. Focus is pinned, the
  // pointer is parked over the title, and then the window stops listening to
  // the real mouse, which could otherwise cross it mid-recording. The views
  // are driven by clicks made in the page, which still work.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await send("Input.setIgnoreInputEvents", { ignore: true });
  await evaluate(
    `new Promise((resolve) => { const ready = () => document.querySelector(".cards") ? resolve() : setTimeout(ready, 100); ready(); })`,
  );
  for (const width of WIDTHS) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHT, deviceScaleFactor: 0, mobile: false });
    for (const density of ["tiles", "compact", "list"]) {
      await setDensity(density);
      await record(`${width}/dashboard-${density}`);
    }
    await setDensity("tiles");
    await click(".card__menu-button");
    await record(`${width}/card-menu`);
    await click(".card__menu-button");
    await click(".profile-card__edit");
    await record(`${width}/profile-editor`);
    await click('.title-bar__control[aria-label="Settings"]');
    const tabs = await evaluate(`document.querySelectorAll(".settings .tabs__tab").length`);
    for (let tab = 0; tab < tabs; tab += 1) {
      await evaluate(`document.querySelectorAll(".settings .tabs__tab")[${tab}].click()`);
      await record(`${width}/settings-${tab}`);
    }
    await click('.title-bar__control[aria-label="Settings"]');
    for (const [name, selector] of [
      ["history", '.title-bar__control[aria-label="Instance history"]'],
      ["adopt", '.title-bar__control[aria-label="Adopt a conversation"]'],
      ["reference", ".status-bar__links button"],
    ]) {
      await click(selector);
      await record(`${width}/${name}`);
      await closeDialogs();
    }
    await evaluate(
      `[...document.querySelectorAll(".tile-controls button")].find((b) => b.textContent === "Layouts")?.click()`,
    );
    await record(`${width}/layouts`);
    await closeDialogs();
    await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))`);
    await record(`${width}/palette`);
    await closeDialogs();
  }
  return views;
}

async function recordStyles(out) {
  const dir = path.join(os.tmpdir(), "hekaton-style-check");
  seed(dir);
  const port = await freePort();
  const app = spawn(electron, [".", `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`], {
    cwd: root,
    env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, "claude") },
    stdio: "ignore",
  });
  try {
    const connection = await connect((await bridgeTarget(port)).webSocketDebuggerUrl);
    const views = await walkViews(connection);
    connection.socket.close();
    writeFileSync(out, JSON.stringify(views));
    const elements = Object.values(views).reduce((sum, view) => sum + Object.keys(view).length, 0);
    console.log(`${out}: ${Object.keys(views).length} views, ${elements} elements`);
  } finally {
    app.kill();
  }
}

function compareStyles(before, after) {
  const a = JSON.parse(readFileSync(before, "utf8"));
  const b = JSON.parse(readFileSync(after, "utf8"));
  let changed = 0;
  for (const view of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[view] ?? {};
    const y = b[view] ?? {};
    const differ = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(
      (element) => !LIVE_TEXT.test(element) && x[element] !== y[element],
    );
    if (differ.length === 0) continue;
    changed += differ.length;
    console.log(`${view}: ${differ.length} changed`);
    for (const element of differ.slice(0, 5)) console.log(`  ${element.split(">").slice(-2).join(" > ")}`);
  }
  console.log(changed === 0 ? "No style changes." : `${changed} element styles changed.`);
  return changed === 0;
}

const [command, ...files] = process.argv.slice(2);
if (command === "record" && files.length === 1) {
  await recordStyles(files[0]);
} else if (command === "compare" && files.length === 2) {
  process.exitCode = compareStyles(...files) ? 0 : 1;
} else {
  console.error("usage: style-check.mjs record <file.json> | compare <before.json> <after.json>");
  process.exitCode = 2;
}
