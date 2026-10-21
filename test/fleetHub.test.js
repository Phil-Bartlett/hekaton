import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFleet, mergeHosts } from "../src/main/fleet.js";

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hekaton-fleet-hub-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

describe("mergeHosts", () => {
  it("prefers the hub's word for a machine it can see, the folder's otherwise", () => {
    const folder = [
      { id: "a", name: "alpha", online: true, sessions: [{ id: "f1" }], dormant: [] },
      { id: "b", name: "bravo", online: false, sessions: [], dormant: [{ id: "d1" }] },
    ];
    const hub = [
      { id: "a", name: "alpha", online: true, sessions: [{ id: "h1" }], dormant: [] },
      { id: "b", name: "bravo", online: false, sessions: [], dormant: [] },
      { id: "c", name: "charlie", online: false, sessions: [], dormant: [{ id: "d2" }] },
    ];
    expect(mergeHosts(folder, hub).map((h) => [h.id, h.via, h.online, h.sessions.length, h.dormant.length])).toEqual([
      ["a", "hub", true, 1, 0],
      ["b", "folder", false, 0, 1],
      ["c", "hub", false, 0, 1],
    ]);
    expect(mergeHosts(folder, hub)[0].sessions).toEqual([{ id: "h1" }]);
    expect(mergeHosts([], []).length).toBe(0);
  });
});

// A stand-in for the hub client: records what the fleet hands it.
function fakeHub() {
  const sent = { presence: 0, commands: [] };
  return {
    sent,
    up: true,
    online() {
      return this.up;
    },
    sendPresence() {
      sent.presence += 1;
      return this.up;
    },
    sendCommand(command) {
      sent.commands.push(command);
      return this.up;
    },
  };
}

describe("createFleet with a hub", () => {
  function fleetFor(onChange = () => {}) {
    return createFleet({
      dataDir: dir,
      device: { id: "dev-1", name: "helix" },
      appVersion: "0.4.0",
      liveSessions: () => [
        { id: "s1", sessionId: "l1", startedAt: 1, profile: { name: "P", cwd: "C:/p" }, telemetry: { state: "idle" } },
      ],
      dormantCards: () => [{ id: "d1", profileName: "P" }],
      onCommand: () => ({ ok: true }),
      onChange,
    });
  }

  it("publishes presence to the hub as well as the folder, with saved cards", () => {
    const fleet = fleetFor();
    const hub = fakeHub();
    fleet.attachHub(hub);
    expect(fleet.presencePayload()).toEqual({
      sessions: [expect.objectContaining({ id: "s1", state: "idle" })],
      dormant: [{ id: "d1", profileName: "P" }],
    });
    fleet.stop();
    expect(hub.sent.presence).toBe(1);
  });

  it("shows hub machines, sends through the hub when it can, and settles on the answer", async () => {
    let changes = 0;
    const fleet = fleetFor(() => (changes += 1));
    const hub = fakeHub();
    fleet.attachHub(hub);
    writeJson(path.join(dir, "hosts", "dev-folder", "host.json"), {
      name: "folder-only",
      seenAt: Date.now(),
      sessions: [],
    });
    await fleet.refresh();
    fleet.setHubHosts([{ id: "dev-hub", name: "laptop", online: true, sessions: [{ id: "x" }], dormant: [] }]);
    expect(fleet.hosts().map((h) => [h.id, h.via])).toEqual([
      ["dev-folder", "folder"],
      ["dev-hub", "hub"],
    ]);

    const viaHub = fleet.send("dev-hub", "terminate", "x");
    expect(viaHub.ok).toBe(true);
    expect(hub.sent.commands).toEqual([
      { id: viaHub.id, to: "dev-hub", command: "terminate", cardId: "x", sentAt: expect.any(Number) },
    ]);
    expect(fleet.pending()).toMatchObject([{ id: viaHub.id, via: "hub", hostId: "dev-hub" }]);

    const viaFolder = fleet.send("dev-folder", "resume", "y");
    expect(viaFolder.ok).toBe(true);
    expect(hub.sent.commands).toHaveLength(1);
    expect(fleet.pending().find((entry) => entry.id === viaFolder.id)).toMatchObject({ via: "folder" });

    const before = changes;
    fleet.settle(viaHub.id, true, null);
    expect(fleet.pending().map((entry) => entry.id)).toEqual([viaFolder.id]);
    expect(changes).toBe(before + 1);
    fleet.settle(viaFolder.id, false, "No such card here");
    expect(fleet.pending()[0]).toMatchObject({ id: viaFolder.id, error: "No such card here" });
    fleet.settle("unknown", true, null);
    expect(changes).toBe(before + 2);
  });

  it("falls back to the folder when the hub link is down, and forgets hub machines when detached", async () => {
    const fleet = fleetFor();
    const hub = fakeHub();
    fleet.attachHub(hub);
    writeJson(path.join(dir, "hosts", "dev-both", "host.json"), { name: "both", seenAt: Date.now(), sessions: [] });
    await fleet.refresh();
    fleet.setHubHosts([{ id: "dev-both", name: "both", online: true, sessions: [], dormant: [] }]);
    hub.up = false;
    const sent = fleet.send("dev-both", "terminate", "z");
    expect(sent.ok).toBe(true);
    expect(fleet.pending()[0].via).toBe("folder");
    expect(hub.sent.commands).toEqual([]);

    fleet.attachHub(null);
    expect(fleet.hosts().map((h) => h.via)).toEqual(["folder"]);
  });
});
