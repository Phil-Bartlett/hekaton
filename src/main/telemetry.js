import http from "node:http";

const MAX_BODY_BYTES = 1_000_000;
const ROUTE = /^\/(hook|status)\/([0-9a-f-]{36})$/;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Loopback-only receiver for the hook and statusline relays. The instance id
// in the path is a random UUID the app minted, so a request for an unknown
// one is simply dropped. `deliver(kind, instanceId, payload, meta)` returns
// false when the instance is unknown; meta carries what the relay learnt from
// its environment.
export function startTelemetryServer(deliver) {
  const server = http.createServer(async (req, res) => {
    const match = req.method === "POST" ? ROUTE.exec(req.url ?? "") : null;
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400).end();
      return;
    }
    const remoteControlId = typeof req.headers["x-hekaton-rc"] === "string" ? req.headers["x-hekaton-rc"] : "";
    res.writeHead(deliver(match[1], match[2], payload, { remoteControlId: remoteControlId || null }) ? 204 : 404).end();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        hookUrl: (instanceId) => `http://127.0.0.1:${port}/hook/${instanceId}`,
        statusUrl: (instanceId) => `http://127.0.0.1:${port}/status/${instanceId}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
