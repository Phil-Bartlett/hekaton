import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";

// The Hekaton hub: a small relay that every machine dials out to, so the
// machines can see each other and ask things of each other from anywhere,
// not only through a shared folder. It holds each machine's last presence
// (live sessions and saved cards), fans the whole roster out whenever
// anything changes, and forwards commands and their results between
// machines. It never sees a terminal, a transcript or a memory note.
//
// Trust: a machine pairs once with the pairing code and receives its own
// token, which is what it presents from then on. Only the token's hash is
// kept, so the hub's files are no use to anyone who copies them.
//
//   HUB_PAIRING_CODE   required; what a new machine must know to pair
//   HUB_DATA           folder for tokens and last presence (default ./data)
//   PORT               listen port (default 8600)
//   HUB_TRUST_PROXY    "1" when behind a reverse proxy, to rate-limit by the
//                      forwarded address rather than the proxy's

export const PROTOCOL = 1;
const MAX_PAYLOAD_BYTES = 1_000_000;
const PING_MS = 30_000;
const ROSTER_DELAY_MS = 200;
const PAIR_FAILURES_ALLOWED = 5;
const PAIR_LOCKOUT_MS = 10 * 60_000;
const COMMAND_TYPES = new Set(["terminate", "resume"]);

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

function deviceOf(message) {
  const device = message?.device;
  if (!device || typeof device.id !== "string" || !device.id || typeof device.name !== "string") return null;
  return {
    id: device.id,
    name: device.name.slice(0, 80) || device.id,
    platform: typeof device.platform === "string" ? device.platform : null,
    app: typeof device.app === "string" ? device.app : null,
  };
}

// Failed pairing attempts per address; a run of them locks that address out
// for a while, so the code cannot be guessed by trying.
function createPairLimiter() {
  const failures = new Map();
  return {
    allowed(address, now = Date.now()) {
      const entry = failures.get(address);
      if (!entry) return true;
      if (now - entry.at > PAIR_LOCKOUT_MS) {
        failures.delete(address);
        return true;
      }
      return entry.count < PAIR_FAILURES_ALLOWED;
    },
    failed(address, now = Date.now()) {
      const entry = failures.get(address);
      failures.set(address, { count: (entry?.count ?? 0) + 1, at: now });
    },
    passed(address) {
      failures.delete(address);
    },
  };
}

export function createHub({ port = 8600, pairingCode, dataDir = "data", trustProxy = false, log = console } = {}) {
  if (!pairingCode) throw new Error("HUB_PAIRING_CODE is required");
  const tokensFile = path.join(dataDir, "tokens.json");
  const presenceFile = path.join(dataDir, "presence.json");
  // tokenHash -> { deviceId, name, issuedAt }
  const tokens = new Map(Object.entries(readJson(tokensFile, {})));
  // deviceId -> { device, sessions, dormant, seenAt }: the last word from each machine.
  const presence = new Map(Object.entries(readJson(presenceFile, {})));
  // deviceId -> socket, for the machines connected right now.
  const connected = new Map();
  const limiter = createPairLimiter();
  let rosterTimer = null;

  function saveTokens() {
    writeJsonAtomic(tokensFile, Object.fromEntries(tokens));
  }

  function savePresence() {
    writeJsonAtomic(presenceFile, Object.fromEntries(presence));
  }

  function roster(except) {
    return [...presence.entries()]
      .filter(([id]) => id !== except)
      .map(([id, entry]) => ({
        id,
        name: entry.device.name,
        platform: entry.device.platform,
        app: entry.device.app,
        online: connected.has(id),
        seenAt: entry.seenAt,
        sessions: connected.has(id) ? entry.sessions : [],
        dormant: entry.dormant,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  function send(socket, message) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  // Everyone hears about a change at most a few times a second.
  function broadcastRoster() {
    if (rosterTimer) return;
    rosterTimer = setTimeout(() => {
      rosterTimer = null;
      for (const [id, socket] of connected) send(socket, { type: "hosts", hosts: roster(id) });
    }, ROSTER_DELAY_MS);
  }

  function addressOf(req) {
    const forwarded = trustProxy ? req.headers["x-forwarded-for"] : null;
    return (typeof forwarded === "string" && forwarded.split(",")[0].trim()) || req.socket.remoteAddress || "?";
  }

  function pair(socket, message, address) {
    const device = deviceOf(message);
    if (!limiter.allowed(address)) {
      send(socket, { type: "error", message: "Too many pairing attempts; try again later" });
      return socket.close(4029, "rate limited");
    }
    if (!device || typeof message.code !== "string" || !sameSecret(message.code, pairingCode)) {
      limiter.failed(address);
      send(socket, { type: "error", message: "Pairing refused" });
      return socket.close(4001, "pairing refused");
    }
    limiter.passed(address);
    // A machine pairing again replaces its earlier token.
    for (const [hash, entry] of tokens) if (entry.deviceId === device.id) tokens.delete(hash);
    const token = randomBytes(32).toString("hex");
    tokens.set(hashToken(token), { deviceId: device.id, name: device.name, issuedAt: Date.now() });
    saveTokens();
    log.info?.(`paired ${device.name} (${device.id})`);
    send(socket, { type: "paired", token });
  }

  function hello(socket, message, state) {
    const device = deviceOf(message);
    const entry = typeof message.token === "string" ? tokens.get(hashToken(message.token)) : null;
    if (!device || !entry || entry.deviceId !== device.id) {
      send(socket, { type: "error", message: "Not paired" });
      return socket.close(4003, "not paired");
    }
    // A second connection from the same machine replaces the first.
    connected.get(device.id)?.close(4000, "replaced");
    state.deviceId = device.id;
    connected.set(device.id, socket);
    const previous = presence.get(device.id);
    presence.set(device.id, {
      device,
      sessions: previous?.sessions ?? [],
      dormant: previous?.dormant ?? [],
      seenAt: Date.now(),
    });
    savePresence();
    send(socket, { type: "welcome", protocol: PROTOCOL, hosts: roster(device.id) });
    broadcastRoster();
    log.info?.(`${device.name} connected`);
  }

  function onMessage(socket, state, raw, address) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return socket.close(4400, "bad json");
    }
    if (!state.deviceId) {
      if (message?.type === "pair") return pair(socket, message, address);
      if (message?.type === "hello") return hello(socket, message, state);
      return socket.close(4401, "hello first");
    }
    const self = presence.get(state.deviceId);
    switch (message?.type) {
      case "presence": {
        self.sessions = Array.isArray(message.sessions) ? message.sessions : [];
        self.dormant = Array.isArray(message.dormant) ? message.dormant : [];
        self.seenAt = Date.now();
        savePresence();
        return broadcastRoster();
      }
      case "command": {
        const { id, to, command, cardId, sentAt } = message;
        if (typeof id !== "string" || typeof to !== "string" || typeof cardId !== "string") return;
        if (!COMMAND_TYPES.has(command))
          return send(socket, { type: "result", id, ok: false, error: "Unknown command" });
        const target = connected.get(to);
        if (!target) {
          // A machine that paired but has never connected is known only from its token.
          const name =
            presence.get(to)?.device.name ??
            [...tokens.values()].find((entry) => entry.deviceId === to)?.name ??
            "That machine";
          return send(socket, { type: "result", id, ok: false, error: `${name} is not connected` });
        }
        return send(target, {
          type: "command",
          id,
          from: state.deviceId,
          command,
          cardId,
          sentAt: sentAt ?? Date.now(),
        });
      }
      case "result": {
        const { id, to, ok, error } = message;
        if (typeof id !== "string" || typeof to !== "string") return;
        const target = connected.get(to);
        if (target) send(target, { type: "result", id, from: state.deviceId, ok: ok === true, error: error ?? null });
        return;
      }
      case "unpair": {
        for (const [hash, entry] of tokens) if (entry.deviceId === state.deviceId) tokens.delete(hash);
        saveTokens();
        presence.delete(state.deviceId);
        savePresence();
        log.info?.(`${self.device.name} unpaired`);
        socket.close(4002, "unpaired");
        return broadcastRoster();
      }
      default:
        return;
    }
  }

  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") return res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES });

  wss.on("connection", (socket, req) => {
    const state = { deviceId: null, alive: true };
    socket.hekatonState = state;
    const address = addressOf(req);
    socket.on("pong", () => {
      state.alive = true;
    });
    socket.on("message", (raw, isBinary) => {
      if (isBinary) return socket.close(4400, "text only");
      onMessage(socket, state, raw.toString("utf8"), address);
    });
    socket.on("close", () => {
      if (state.deviceId && connected.get(state.deviceId) === socket) {
        connected.delete(state.deviceId);
        const entry = presence.get(state.deviceId);
        if (entry) {
          entry.seenAt = Date.now();
          savePresence();
          log.info?.(`${entry.device.name} disconnected`);
        }
        broadcastRoster();
      }
    });
    socket.on("error", () => {});
  });

  // A machine that stops answering pings is dropped, so a dead link never
  // shows as online for long.
  const pinger = setInterval(() => {
    for (const socket of wss.clients) {
      const state = socket.hekatonState;
      if (!state.alive) {
        socket.terminate();
        continue;
      }
      state.alive = false;
      socket.ping();
    }
  }, PING_MS);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      resolve({
        port: server.address().port,
        roster: () => roster(null),
        close: () =>
          new Promise((done) => {
            clearInterval(pinger);
            for (const socket of wss.clients) socket.terminate();
            wss.close(() => server.close(() => done()));
          }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hub = await createHub({
    port: Number(process.env.PORT) || 8600,
    pairingCode: process.env.HUB_PAIRING_CODE,
    dataDir: process.env.HUB_DATA || "data",
    trustProxy: process.env.HUB_TRUST_PROXY === "1",
  });
  console.log(`hekaton hub listening on ${hub.port}`);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await hub.close();
      process.exit(0);
    });
  }
}
