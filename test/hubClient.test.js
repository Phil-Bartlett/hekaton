import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHub } from "../server/hub.js";
import { createHubClient, pairWithHub } from "../src/main/hubClient.js";

const CODE = "a long pairing phrase";
const quiet = { info() {} };
const laptop = { id: "dev-laptop", name: "laptop", platform: "linux", app: "0.4.0" };
const desk = { id: "dev-desk", name: "helix", platform: "win32", app: "0.4.0" };
let dir;
let hub;
const started = [];

function freePort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hekaton-hubclient-"));
  hub = await createHub({ port: 0, pairingCode: CODE, dataDir: dir, log: quiet });
});

afterEach(async () => {
  for (const client of started.splice(0)) client.stop();
  await hub.close();
  rmSync(dir, { recursive: true, force: true });
});

const url = () => `ws://127.0.0.1:${hub.port}`;
const until = (check, ms = 3000) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const value = check();
      if (value) return resolve(value);
      if (Date.now() - started > ms) return reject(new Error("timed out"));
      setTimeout(tick, 25);
    };
    tick();
  });

function connect(device, token, overrides = {}) {
  const seen = { hosts: [], results: [], statuses: [] };
  const client = createHubClient({
    url: url(),
    token,
    device,
    presence: () => ({ sessions: [{ id: `${device.id}-s1`, state: "idle" }], dormant: [] }),
    onHosts: (hosts) => seen.hosts.push(hosts),
    onCommand: async () => ({ ok: true }),
    onResult: (result) => seen.results.push(result),
    onStatus: (status) => seen.statuses.push(status.status),
    random: () => 0.5,
    ...overrides,
  });
  client.start();
  started.push(client);
  return { client, seen };
}

describe("pairWithHub", () => {
  it("returns a token for the right code and an error for the wrong one", async () => {
    await expect(pairWithHub(url(), "wrong", laptop)).rejects.toThrow("Pairing refused");
    const token = await pairWithHub(url(), CODE, laptop);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives up when nothing is listening", async () => {
    await expect(pairWithHub(`ws://127.0.0.1:${await freePort()}`, CODE, laptop)).rejects.toThrow(/hub/);
  });
});

describe("createHubClient", () => {
  it("says hello, reports the roster, and sends its presence", async () => {
    const laptopToken = await pairWithHub(url(), CODE, laptop);
    const a = connect(laptop, laptopToken);
    await until(() => a.client.online());
    expect(a.seen.statuses).toEqual(["connecting", "online"]);
    expect(a.seen.hosts[0]).toEqual([]);

    const b = connect(desk, await pairWithHub(url(), CODE, desk));
    await until(() => b.client.online());
    const rosterSeenByA = await until(() => a.seen.hosts.find((hosts) => hosts.some((h) => h.id === "dev-desk")));
    expect(rosterSeenByA[0]).toMatchObject({ id: "dev-desk", name: "helix", online: true });
    await until(() => a.seen.hosts.at(-1)[0]?.sessions.length === 1);
    expect(a.seen.hosts.at(-1)[0].sessions).toEqual([{ id: "dev-desk-s1", state: "idle" }]);
  });

  it("carries a command to the other machine and the answer back", async () => {
    const onCommand = vi.fn(async ({ type, cardId }) =>
      type === "terminate" && cardId === "card-1" ? { ok: true } : { ok: false, error: "No such card here" },
    );
    const a = connect(laptop, await pairWithHub(url(), CODE, laptop));
    const b = connect(desk, await pairWithHub(url(), CODE, desk), { onCommand });
    await until(() => a.client.online() && b.client.online());
    expect(a.client.sendCommand({ id: "c1", to: "dev-desk", command: "terminate", cardId: "card-1", sentAt: 1 })).toBe(
      true,
    );
    expect(a.client.sendCommand({ id: "c2", to: "dev-desk", command: "resume", cardId: "card-2", sentAt: 2 })).toBe(
      true,
    );
    await until(() => a.seen.results.length === 2);
    expect(onCommand.mock.calls.map(([command]) => [command.type, command.cardId, command.from])).toEqual([
      ["terminate", "card-1", "dev-laptop"],
      ["resume", "card-2", "dev-laptop"],
    ]);
    expect(a.seen.results).toEqual([
      { id: "c1", ok: true, error: null },
      { id: "c2", ok: false, error: "No such card here" },
    ]);
  });

  it("refuses to send while offline and stops cleanly", async () => {
    const a = connect(laptop, await pairWithHub(url(), CODE, laptop));
    await until(() => a.client.online());
    a.client.stop();
    expect(a.client.online()).toBe(false);
    expect(a.client.sendCommand({ id: "c9", to: "dev-desk", command: "terminate", cardId: "x" })).toBe(false);
    expect(a.client.status().status).toBe("offline");
  });

  it("stays in error after the hub refuses its token", async () => {
    await pairWithHub(url(), CODE, laptop);
    const a = connect(laptop, "0".repeat(64));
    const status = await until(() => a.client.status().status === "error" && a.client.status());
    expect(status.error).toBe("Not paired");
  });

  it("comes back by itself when the hub returns", async () => {
    const port = await freePort();
    await hub.close();
    hub = await createHub({ port, pairingCode: CODE, dataDir: dir, log: quiet });
    const token = await pairWithHub(url(), CODE, laptop);
    const a = connect(laptop, token, { random: () => 0 });
    await until(() => a.client.online());
    await hub.close();
    await until(() => a.client.status().status === "offline");
    hub = await createHub({ port, pairingCode: CODE, dataDir: dir, log: quiet });
    await until(() => a.client.online(), 6000);
    expect(a.seen.statuses).toEqual(["connecting", "online", "offline", "connecting", "online"]);
  });

  it("unpairs, after which the token no longer works", async () => {
    const token = await pairWithHub(url(), CODE, laptop);
    const a = connect(laptop, token);
    await until(() => a.client.online());
    a.client.unpair();
    await until(() => hub.roster().length === 0);
    const again = connect(laptop, token);
    await until(() => again.client.status().status === "error");
  });
});
