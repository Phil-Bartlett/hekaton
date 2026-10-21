import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHub } from "../server/hub.js";

const CODE = "correct horse battery staple";
const quiet = { info() {} };
let dir;
let hub;
const clients = [];

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hekaton-hub-"));
  hub = await createHub({ port: 0, pairingCode: CODE, dataDir: dir, log: quiet });
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.close();
  await hub.close();
  rmSync(dir, { recursive: true, force: true });
});

// A test client over the same global WebSocket the app uses: `next(type)`
// resolves with the next frame of that type, buffering the rest.
function client() {
  const socket = new WebSocket(`ws://127.0.0.1:${hub.port}`);
  const queue = [];
  const waiting = [];
  const closed = new Promise((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const index = waiting.findIndex(([type]) => type === message.type);
    if (index === -1) queue.push(message);
    else waiting.splice(index, 1)[0][1](message);
  });
  const api = {
    socket,
    closed,
    open: new Promise((resolve) => socket.addEventListener("open", resolve)),
    send: (message) => socket.send(JSON.stringify(message)),
    next: (type) =>
      new Promise((resolve, reject) => {
        const index = queue.findIndex((message) => message.type === type);
        if (index !== -1) return resolve(queue.splice(index, 1)[0]);
        waiting.push([type, resolve]);
        setTimeout(() => reject(new Error(`no ${type} frame within 3s`)), 3000);
      }),
  };
  clients.push(api);
  return api;
}

const laptop = { id: "dev-laptop", name: "laptop", platform: "linux", app: "0.4.0" };
const desk = { id: "dev-desk", name: "helix", platform: "win32", app: "0.4.0" };

async function pair(device) {
  const c = client();
  await c.open;
  c.send({ type: "pair", code: CODE, device });
  const { token } = await c.next("paired");
  c.socket.close();
  return token;
}

async function join(device, token) {
  const c = client();
  await c.open;
  c.send({ type: "hello", token, device });
  const welcome = await c.next("welcome");
  return { ...c, welcome };
}

describe("pairing", () => {
  it("issues a token for the right code, keeps only its hash, and refuses the wrong one", async () => {
    const token = await pair(laptop);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const stored = JSON.parse(readFileSync(path.join(dir, "tokens.json"), "utf8"));
    expect(Object.keys(stored)).toHaveLength(1);
    expect(Object.keys(stored)[0]).not.toBe(token);
    expect(Object.values(stored)[0]).toMatchObject({ deviceId: "dev-laptop", name: "laptop" });

    const wrong = client();
    await wrong.open;
    wrong.send({ type: "pair", code: "nope", device: laptop });
    expect((await wrong.next("error")).message).toBe("Pairing refused");
    expect(await wrong.closed).toBe(4001);
  });

  it("locks an address out after repeated wrong codes", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const c = client();
      await c.open;
      c.send({ type: "pair", code: "nope", device: laptop });
      await c.closed;
    }
    const locked = client();
    await locked.open;
    locked.send({ type: "pair", code: CODE, device: laptop });
    expect((await locked.next("error")).message).toMatch(/Too many/);
    expect(await locked.closed).toBe(4029);
  });

  it("requires hello first, with a token issued to that machine", async () => {
    const token = await pair(laptop);
    const early = client();
    await early.open;
    early.send({ type: "presence", sessions: [] });
    expect(await early.closed).toBe(4401);

    const imposter = client();
    await imposter.open;
    imposter.send({ type: "hello", token, device: desk });
    expect((await imposter.next("error")).message).toBe("Not paired");
    expect(await imposter.closed).toBe(4003);

    const real = await join(laptop, token);
    expect(real.welcome).toMatchObject({ protocol: 1, hosts: [] });
  });
});

describe("roster and presence", () => {
  it("tells each machine about the others, live while connected, saved cards always", async () => {
    const laptopToken = await pair(laptop);
    const deskToken = await pair(desk);
    const a = await join(laptop, laptopToken);
    const b = await join(desk, deskToken);
    expect(b.welcome.hosts.map((h) => [h.id, h.online])).toEqual([["dev-laptop", true]]);
    expect((await a.next("hosts")).hosts.map((h) => [h.id, h.online])).toEqual([["dev-desk", true]]);

    b.send({ type: "presence", sessions: [{ id: "s1", state: "running" }], dormant: [{ id: "d1" }] });
    const seen = (await a.next("hosts")).hosts[0];
    expect(seen).toMatchObject({ id: "dev-desk", name: "helix", online: true });
    expect(seen.sessions).toEqual([{ id: "s1", state: "running" }]);
    expect(seen.dormant).toEqual([{ id: "d1" }]);

    b.socket.close();
    const gone = (await a.next("hosts")).hosts[0];
    expect(gone).toMatchObject({ id: "dev-desk", online: false, sessions: [], dormant: [{ id: "d1" }] });
    expect(hub.roster().map((h) => [h.name, h.online])).toEqual([
      ["helix", false],
      ["laptop", true],
    ]);
  });

  it("remembers tokens and presence across a restart", async () => {
    const token = await pair(desk);
    const b = await join(desk, token);
    b.send({ type: "presence", sessions: [], dormant: [{ id: "d1" }] });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await hub.close();
    hub = await createHub({ port: 0, pairingCode: CODE, dataDir: dir, log: quiet });
    expect(hub.roster()).toMatchObject([{ id: "dev-desk", online: false, dormant: [{ id: "d1" }] }]);
    const again = await join(desk, token);
    expect(again.welcome.hosts).toEqual([]);
  });
});

describe("commands", () => {
  it("forwards a request to the machine that owns the card and its answer back", async () => {
    const a = await join(laptop, await pair(laptop));
    const b = await join(desk, await pair(desk));
    a.send({ type: "command", id: "c1", to: "dev-desk", command: "terminate", cardId: "card-9", sentAt: 5 });
    const request = await b.next("command");
    expect(request).toEqual({
      type: "command",
      id: "c1",
      from: "dev-laptop",
      command: "terminate",
      cardId: "card-9",
      sentAt: 5,
    });
    b.send({ type: "result", id: "c1", to: "dev-laptop", ok: false, error: "Not running here" });
    expect(await a.next("result")).toEqual({
      type: "result",
      id: "c1",
      from: "dev-desk",
      ok: false,
      error: "Not running here",
    });
  });

  it("answers at once when the other machine is away or the command is unknown", async () => {
    const a = await join(laptop, await pair(laptop));
    await pair(desk);
    a.send({ type: "command", id: "c2", to: "dev-desk", command: "resume", cardId: "x" });
    expect(await a.next("result")).toMatchObject({ id: "c2", ok: false, error: "helix is not connected" });
    a.send({ type: "command", id: "c3", to: "dev-desk", command: "reboot", cardId: "x" });
    expect(await a.next("result")).toMatchObject({ id: "c3", ok: false, error: "Unknown command" });
  });
});

describe("unpair", () => {
  it("forgets the machine and its token", async () => {
    const token = await pair(laptop);
    const a = await join(laptop, token);
    a.send({ type: "unpair" });
    expect(await a.closed).toBe(4002);
    expect(hub.roster()).toEqual([]);
    const back = client();
    await back.open;
    back.send({ type: "hello", token, device: laptop });
    expect(await back.closed).toBe(4003);
  });
});
