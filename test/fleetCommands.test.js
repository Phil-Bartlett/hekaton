import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_MAX_AGE_MS,
  PENDING_TIMEOUT_MS,
  RESULT_KEEP_MS,
  createFleet,
  pruneResults,
  readInbox,
  readResult,
  sendCommand,
  writeResult,
} from "../src/main/fleet.js";

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hekaton-fleet-cmd-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function presence(id, name, seenAt) {
  writeJson(path.join(dir, "hosts", id, "host.json"), { id, name, seenAt, sessions: [] });
}

describe("sendCommand and readInbox", () => {
  it("puts a new file in the other machine's inbox that only it will act on", () => {
    const sent = sendCommand(dir, {
      to: "dev-2",
      from: "dev-1",
      type: "terminate",
      cardId: "card-1",
      uuid: () => "c1",
      now: 500,
    });
    expect(sent).toEqual({ id: "c1", to: "dev-2", from: "dev-1", type: "terminate", cardId: "card-1", sentAt: 500 });
    const file = path.join(dir, "hosts", "dev-2", "inbox", "c1.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(sent);
    expect(readInbox(path.join(dir, "hosts", "dev-2"), { self: "dev-2", now: 600 })).toEqual([{ ...sent, file }]);
    expect(readInbox(path.join(dir, "hosts", "dev-2"), { self: "dev-9", now: 600 })).toEqual([]);
  });

  it("drops what is malformed or too old, and orders the rest by when it was sent", () => {
    const inbox = path.join(dir, "hosts", "dev-2", "inbox");
    const now = 10_000_000;
    sendCommand(dir, { to: "dev-2", from: "dev-1", type: "resume", cardId: "b", uuid: () => "later", now: now - 10 });
    sendCommand(dir, {
      to: "dev-2",
      from: "dev-1",
      type: "terminate",
      cardId: "a",
      uuid: () => "earlier",
      now: now - 20,
    });
    sendCommand(dir, {
      to: "dev-2",
      from: "dev-1",
      type: "terminate",
      cardId: "z",
      uuid: () => "old",
      now: now - COMMAND_MAX_AGE_MS - 1,
    });
    writeJson(path.join(inbox, "bad-type.json"), {
      id: "bad-type",
      to: "dev-2",
      type: "reboot",
      cardId: "a",
      sentAt: now,
    });
    writeJson(path.join(inbox, "elsewhere.json"), {
      id: "elsewhere",
      to: "dev-3",
      type: "terminate",
      cardId: "a",
      sentAt: now,
    });
    writeFileSync(path.join(inbox, "partial.json"), "{");
    expect(readInbox(path.join(dir, "hosts", "dev-2"), { self: "dev-2", now }).map((c) => c.id)).toEqual([
      "earlier",
      "later",
    ]);
    expect(readdirSync(inbox).sort()).toEqual(["earlier.json", "later.json", "partial.json"]);
  });
});

describe("results", () => {
  it("are written under the answering machine, read by id, and pruned when old", () => {
    const hostPath = path.join(dir, "hosts", "dev-2");
    const now = 20_000_000;
    writeResult(hostPath, { id: "c1", ok: true, now });
    writeResult(hostPath, { id: "c2", ok: false, error: "Not running here", now: now - RESULT_KEEP_MS - 1 });
    expect(readResult(dir, "dev-2", "c1")).toEqual({ id: "c1", ok: true, error: null, at: now });
    expect(readResult(dir, "dev-2", "c2")).toMatchObject({ ok: false, error: "Not running here" });
    expect(readResult(dir, "dev-2", "missing")).toBeNull();
    pruneResults(hostPath, now);
    expect(readdirSync(path.join(hostPath, "results"))).toEqual(["c1.json"]);
  });
});

describe("createFleet commands", () => {
  function fleetFor(id, name, onCommand, onChange = () => {}) {
    return createFleet({
      dataDir: dir,
      device: { id, name },
      appVersion: "0.4.0",
      liveSessions: () => [],
      onCommand,
      onChange,
    });
  }

  it("carries out what arrives in its inbox, answers, and clears the request", async () => {
    const onCommand = vi.fn((command) =>
      command.type === "terminate" ? { ok: true } : { ok: false, error: "No such card here" },
    );
    const fleet = fleetFor("dev-2", "laptop", onCommand);
    sendCommand(dir, { to: "dev-2", from: "dev-1", type: "terminate", cardId: "a", uuid: () => "c1" });
    sendCommand(dir, { to: "dev-2", from: "dev-1", type: "resume", cardId: "b", uuid: () => "c2" });
    await fleet.refresh();
    expect(onCommand.mock.calls.map(([command]) => [command.type, command.cardId])).toEqual([
      ["terminate", "a"],
      ["resume", "b"],
    ]);
    expect(existsSync(path.join(dir, "hosts", "dev-2", "inbox", "c1.json"))).toBe(false);
    expect(readResult(dir, "dev-2", "c1")).toMatchObject({ ok: true, error: null });
    expect(readResult(dir, "dev-2", "c2")).toMatchObject({ ok: false, error: "No such card here" });
  });

  it("answers a handler that throws with its message", async () => {
    const fleet = fleetFor("dev-2", "laptop", () => {
      throw new Error("boom");
    });
    sendCommand(dir, { to: "dev-2", from: "dev-1", type: "terminate", cardId: "a", uuid: () => "c1" });
    await fleet.refresh();
    expect(readResult(dir, "dev-2", "c1")).toMatchObject({ ok: false, error: "boom" });
  });

  it("sends only to a machine it can see online, and follows the answer", async () => {
    let changes = 0;
    const fleet = fleetFor(
      "dev-1",
      "helix",
      () => ({ ok: true }),
      () => (changes += 1),
    );
    expect(fleet.send("dev-2", "terminate", "a")).toEqual({ ok: false, error: "Unknown machine" });
    presence("dev-2", "laptop", Date.now() - 120_000);
    await fleet.refresh();
    expect(fleet.send("dev-2", "terminate", "a")).toEqual({
      ok: false,
      error: "laptop is not running Hekaton right now",
    });
    presence("dev-2", "laptop", Date.now());
    await fleet.refresh();
    expect(fleet.send("dev-2", "reboot", "a")).toEqual({ ok: false, error: "Unknown command" });
    const sent = fleet.send("dev-2", "terminate", "a");
    expect(sent.ok).toBe(true);
    expect(fleet.pending()).toMatchObject([
      { id: sent.id, hostId: "dev-2", type: "terminate", cardId: "a", error: null },
    ]);
    expect(existsSync(path.join(dir, "hosts", "dev-2", "inbox", `${sent.id}.json`))).toBe(true);

    const before = changes;
    writeResult(path.join(dir, "hosts", "dev-2"), { id: sent.id, ok: true });
    await fleet.refresh();
    expect(fleet.pending()).toEqual([]);
    expect(changes).toBe(before + 1);
  });

  it("keeps a refusal on show, and gives up on a machine that never answers", async () => {
    const fleet = fleetFor("dev-1", "helix", () => ({ ok: true }));
    presence("dev-2", "laptop", Date.now());
    await fleet.refresh();
    const refused = fleet.send("dev-2", "resume", "b");
    writeResult(path.join(dir, "hosts", "dev-2"), { id: refused.id, ok: false, error: "No such card here" });
    await fleet.refresh();
    expect(fleet.pending()).toMatchObject([{ id: refused.id, error: "No such card here" }]);

    const silent = fleet.send("dev-2", "terminate", "a");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + PENDING_TIMEOUT_MS + 1);
      await fleet.refresh();
      expect(fleet.pending().find((entry) => entry.id === silent.id)).toMatchObject({
        error: "No answer from that machine",
      });
      vi.setSystemTime(Date.now() + 60_000);
      await fleet.refresh();
      expect(fleet.pending()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
