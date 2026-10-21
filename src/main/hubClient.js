// Dials out to a Hekaton hub (server/hub.js) and keeps the link up. The hub
// is optional and best effort: the shared-folder transport keeps working
// without it, and a lost link is retried with backoff until it returns.

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PAIR_TIMEOUT_MS = 10_000;
// Presence also goes out on a timer, not only on change, so a frame lost
// under load is made good within a minute.
export const PRESENCE_MS = 30_000;

function parse(data) {
  try {
    return JSON.parse(typeof data === "string" ? data : String(data));
  } catch {
    return null;
  }
}

// One-off exchange: present the pairing code, receive this machine's token.
export function pairWithHub(
  url,
  code,
  device,
  { WebSocketImpl = globalThis.WebSocket, timeoutMs = PAIR_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(token);
    };
    let socket;
    try {
      socket = new WebSocketImpl(url);
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => finish(new Error("The hub did not answer")), timeoutMs);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "pair", code, device })));
    socket.addEventListener("message", (event) => {
      const message = parse(event.data);
      if (message?.type === "paired" && typeof message.token === "string") finish(null, message.token);
      else if (message?.type === "error") finish(new Error(message.message || "Pairing refused"));
    });
    socket.addEventListener("error", () => finish(new Error("Could not reach the hub")));
    socket.addEventListener("close", () => finish(new Error("The hub closed the connection")));
  });
}

// `presence()` gives what to tell the hub; `onHosts(hosts)` receives the
// roster; `onCommand({ type, cardId, from })` carries a request out and
// returns `{ ok, error }`; `onResult({ id, ok, error })` hears answers to
// this machine's own requests; `onStatus()` fires on every link change.
export function createHubClient({
  url,
  token,
  device,
  presence,
  onHosts,
  onCommand,
  onResult,
  onStatus,
  WebSocketImpl = globalThis.WebSocket,
  random = Math.random,
}) {
  let socket = null;
  let stopped = false;
  let attempts = 0;
  let reconnectTimer = null;
  let presenceTimer = null;
  let state = { status: "offline", error: null, since: Date.now() };

  function setStatus(status, error = null) {
    if (state.status === status && state.error === error) return;
    state = { status, error, since: Date.now() };
    onStatus?.(state);
  }

  function online() {
    return socket !== null && socket.readyState === socket.OPEN && state.status === "online";
  }

  function send(message) {
    if (!socket || socket.readyState !== socket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function sendPresence() {
    if (!online()) return false;
    return send({ type: "presence", ...presence() });
  }

  async function handleCommand(message) {
    let result;
    try {
      result = await onCommand({ type: message.command, cardId: message.cardId, from: message.from });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    send({ type: "result", id: message.id, to: message.from, ok: result?.ok === true, error: result?.error ?? null });
  }

  function onMessage(event) {
    const message = parse(event.data);
    switch (message?.type) {
      case "welcome":
        attempts = 0;
        setStatus("online");
        onHosts(Array.isArray(message.hosts) ? message.hosts : []);
        sendPresence();
        return;
      case "hosts":
        onHosts(Array.isArray(message.hosts) ? message.hosts : []);
        return;
      case "command":
        if (typeof message.id === "string" && typeof message.from === "string") handleCommand(message);
        return;
      case "result":
        if (typeof message.id === "string")
          onResult({ id: message.id, ok: message.ok === true, error: message.error ?? null });
        return;
      case "error":
        setStatus("error", message.message || "The hub refused the connection");
        return;
      default:
        return;
    }
  }

  // Exponential backoff with jitter, so a fleet does not stampede a hub
  // that has just come back.
  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempts) * (0.75 + random() * 0.5);
    attempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (stopped) return;
    if (state.status !== "error") setStatus("connecting");
    try {
      socket = new WebSocketImpl(url);
    } catch (error) {
      setStatus("error", error.message);
      scheduleReconnect();
      return;
    }
    socket.addEventListener("open", () => send({ type: "hello", token, device }));
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", () => {});
    socket.addEventListener("close", (event) => {
      socket = null;
      // A refusal (not paired, replaced, unpaired) is final until something
      // changes; anything else is a link that will come back.
      if (event.code >= 4000 && event.code < 4100) {
        if (state.status !== "error") setStatus("error", event.reason || "The hub closed the connection");
        if (event.code === 4000 || event.code === 4002) return;
      } else {
        setStatus("offline", null);
      }
      scheduleReconnect();
    });
  }

  function start() {
    connect();
    presenceTimer = setInterval(sendPresence, PRESENCE_MS);
  }

  function stop() {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearInterval(presenceTimer);
    reconnectTimer = null;
    presenceTimer = null;
    socket?.close();
    socket = null;
    setStatus("offline");
  }

  // Tells the hub to forget this machine, then stops.
  function unpair() {
    send({ type: "unpair" });
    stop();
  }

  return {
    start,
    stop,
    unpair,
    online,
    sendPresence,
    sendCommand: (command) => online() && send({ type: "command", ...command }),
    status: () => state,
  };
}
