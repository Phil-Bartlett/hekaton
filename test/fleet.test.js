import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STALE_MS,
  createFleet,
  migrateLegacyState,
  presenceSession,
  readDevice,
  readHost,
  readHosts,
} from "../src/main/fleet.js";

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hekaton-fleet-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

describe("readDevice", () => {
  it("mints an id on first run and keeps it afterwards", () => {
    const file = path.join(dir, "local", "device.json");
    const first = readDevice(file, { hostname: "helix", uuid: () => "dev-1" });
    expect(first).toEqual({ id: "dev-1", name: "helix" });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ id: "dev-1", name: "helix" });
    expect(readDevice(file, { hostname: "renamed", uuid: () => "dev-2" })).toEqual({ id: "dev-1", name: "helix" });
  });

  it("falls back to the hostname for a name and starts over on a broken file", () => {
    const file = path.join(dir, "device.json");
    writeFileSync(file, '{"id":"dev-1"}');
    expect(readDevice(file, { hostname: "helix" })).toEqual({ id: "dev-1", name: "helix" });
    writeFileSync(file, "not json");
    expect(readDevice(file, { hostname: "helix", uuid: () => "dev-9" })).toEqual({ id: "dev-9", name: "helix" });
  });
});

describe("migrateLegacyState", () => {
  const legacy = {
    version: 1,
    bridge: { x: 1, y: 2, width: 3, height: 4 },
    order: ["mine", "theirs", "old"],
    instances: [{ id: "mine", host: "helix" }, { id: "theirs", host: "laptop" }, { id: "old" }],
  };

  it("takes this machine's cards and unlabelled ones, leaving the legacy file alone", () => {
    const legacyFile = path.join(dir, "state.json");
    const hostFile = path.join(dir, "hosts", "dev-1", "state.json");
    writeJson(legacyFile, legacy);
    expect(migrateLegacyState({ legacyFile, hostFile, hostname: "helix" })).toBe(2);
    expect(JSON.parse(readFileSync(hostFile, "utf8"))).toEqual({
      version: 1,
      bridge: legacy.bridge,
      order: ["mine", "old"],
      instances: [{ id: "mine", host: "helix" }, { id: "old" }],
    });
    expect(JSON.parse(readFileSync(legacyFile, "utf8"))).toEqual(legacy);
  });

  it("runs once, and not at all without a legacy file", () => {
    const legacyFile = path.join(dir, "state.json");
    const hostFile = path.join(dir, "hosts", "dev-1", "state.json");
    expect(migrateLegacyState({ legacyFile, hostFile, hostname: "helix" })).toBe(0);
    expect(existsSync(hostFile)).toBe(false);
    writeJson(legacyFile, legacy);
    writeJson(hostFile, { version: 1, bridge: null, order: [], instances: [] });
    expect(migrateLegacyState({ legacyFile, hostFile, hostname: "helix" })).toBe(0);
    expect(JSON.parse(readFileSync(hostFile, "utf8")).instances).toEqual([]);
  });
});

describe("presenceSession", () => {
  it("keeps what a remote card draws", () => {
    const session = {
      id: "inst-1",
      sessionId: "launch-uuid",
      startedAt: 100,
      profile: { id: "p1", name: "Frontend", accent: "#ff0000", cwd: "C:/proj" },
      telemetry: {
        state: "running",
        since: 150,
        currentTool: "Bash",
        claudeSessionId: null,
        sessionName: null,
        model: { name: "Opus" },
        lastPrompt: "fix it",
        totalCostUsd: 1.5,
        contextPct: 42,
        remoteControlId: null,
      },
      activity: { title: "Fixing the build", links: [{ kind: "pr", url: "https://example/pull/1" }] },
    };
    expect(presenceSession(session)).toEqual({
      id: "inst-1",
      profileId: "p1",
      profileName: "Frontend",
      accent: "#ff0000",
      cwd: "C:/proj",
      claudeSessionId: "launch-uuid",
      title: "Fixing the build",
      model: "Opus",
      state: "running",
      since: 150,
      currentTool: "Bash",
      lastPrompt: "fix it",
      totalCostUsd: 1.5,
      contextPct: 42,
      remoteControlId: null,
      startedAt: 100,
      links: [{ kind: "pr", url: "https://example/pull/1" }],
    });
  });
});

describe("readHost", () => {
  const now = 1_000_000;

  function host(presence, state) {
    const hostPath = path.join(dir, "hosts", "dev-2");
    if (presence) writeJson(path.join(hostPath, "host.json"), presence);
    if (state) writeJson(path.join(hostPath, "state.json"), state);
    return readHost(hostPath, "dev-2", now);
  }

  it("shows live sessions from a fresh presence and the rest as saved", () => {
    const seen = host(
      { name: "laptop", platform: "linux", app: "0.4.0", seenAt: now - 1000, sessions: [{ id: "a", state: "idle" }] },
      {
        version: 1,
        instances: [
          { id: "a", live: true },
          { id: "b", live: false, host: "laptop" },
        ],
      },
    );
    expect(seen).toMatchObject({ id: "dev-2", name: "laptop", platform: "linux", app: "0.4.0", online: true });
    expect(seen.sessions).toEqual([{ id: "a", state: "idle" }]);
    expect(seen.dormant).toEqual([{ id: "b", live: false, host: "laptop" }]);
  });

  it("treats a stale or stopped presence as offline with everything saved", () => {
    const stale = host(
      { name: "laptop", seenAt: now - STALE_MS, sessions: [{ id: "a" }] },
      { version: 1, instances: [{ id: "a", live: true }] },
    );
    expect(stale.online).toBe(false);
    expect(stale.sessions).toEqual([]);
    expect(stale.dormant).toEqual([{ id: "a", live: false }]);
    rmSync(path.join(dir, "hosts"), { recursive: true, force: true });
    const stopped = host({ name: "laptop", seenAt: now, stoppedAt: now, sessions: [] }, null);
    expect(stopped).toMatchObject({ online: false, sessions: [], dormant: [] });
  });

  it("names a host from its cards when it has never published presence", () => {
    const seen = host(null, { version: 1, instances: [{ id: "a", host: "laptop" }] });
    expect(seen).toMatchObject({ name: "laptop", online: false, dormant: [{ id: "a", host: "laptop", live: false }] });
    expect(readHost(path.join(dir, "hosts", "nothing"), "nothing", now)).toBeNull();
  });
});

describe("readHosts", () => {
  it("lists every other machine by name and skips this one", () => {
    const now = 5_000_000;
    writeJson(path.join(dir, "hosts", "me", "host.json"), { name: "helix", seenAt: now, sessions: [] });
    writeJson(path.join(dir, "hosts", "dev-b", "host.json"), { name: "zeta", seenAt: now, sessions: [] });
    writeJson(path.join(dir, "hosts", "dev-a", "host.json"), { name: "alpha", seenAt: now, sessions: [] });
    writeFileSync(path.join(dir, "hosts", "stray.txt"), "");
    expect(readHosts(dir, { exclude: "me", now }).map((h) => h.name)).toEqual(["alpha", "zeta"]);
    expect(readHosts(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("createFleet", () => {
  it("publishes presence under its own host folder and reads the others", () => {
    const now = Date.now();
    writeJson(path.join(dir, "hosts", "dev-2", "host.json"), {
      name: "laptop",
      seenAt: now,
      sessions: [{ id: "x", state: "idle" }],
    });
    let changes = 0;
    const fleet = createFleet({
      dataDir: dir,
      device: { id: "dev-1", name: "helix" },
      appVersion: "0.4.0",
      liveSessions: () => [
        {
          id: "s1",
          sessionId: "l1",
          startedAt: now,
          profile: { name: "P", cwd: "C:/p" },
          telemetry: { state: "idle" },
        },
      ],
      onChange: () => {
        changes += 1;
      },
    });
    expect(fleet.stateFile).toBe(path.join(dir, "hosts", "dev-1", "state.json"));
    fleet.start();
    const presence = JSON.parse(readFileSync(path.join(dir, "hosts", "dev-1", "host.json"), "utf8"));
    expect(presence).toMatchObject({ id: "dev-1", name: "helix", app: "0.4.0", schema: 1 });
    expect(presence.sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(changes).toBe(1);
    expect(fleet.hosts().map((h) => [h.name, h.online, h.sessions.length])).toEqual([["laptop", true, 1]]);
    fleet.refresh();
    expect(changes).toBe(1);
    fleet.stop();
    const stopped = JSON.parse(readFileSync(path.join(dir, "hosts", "dev-1", "host.json"), "utf8"));
    expect(stopped.stoppedAt).toBeGreaterThan(0);
    expect(stopped.sessions).toEqual([]);
  });
});
