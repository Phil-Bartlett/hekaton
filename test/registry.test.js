import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRegistry, sameProcess } from "../src/main/registry.js";

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hekaton-registry-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name, value) =>
  writeFileSync(path.join(dir, name), typeof value === "string" ? value : JSON.stringify(value));

describe("readRegistry", () => {
  it("returns live sessions sorted by start time, dropping dead pids and junk", () => {
    const live = process.pid;
    write("1.json", { pid: live, sessionId: "b", name: "second", cwd: "C:/b", status: "busy", startedAt: 200 });
    write("2.json", {
      pid: live,
      sessionId: "a",
      name: "first",
      cwd: "C:/a",
      status: "idle",
      startedAt: 100,
      statusUpdatedAt: 150,
    });
    write("3.json", { pid: 999999, sessionId: "dead", startedAt: 50 });
    write("4.json", "{not json");
    write("5.json", { pid: live });
    write("6.key", "secret");
    expect(readRegistry(dir).map((row) => row.sessionId)).toEqual(["a", "b"]);
    expect(readRegistry(dir)[0]).toEqual({
      pid: live,
      sessionId: "a",
      name: "first",
      cwd: "C:/a",
      status: "idle",
      statusSince: 150,
      startedAt: 100,
      version: null,
      entrypoint: null,
      remoteControlId: null,
      procStart: null,
    });
    expect(readRegistry(dir)[1].statusSince).toBe(200);
  });

  it("reads how a session was started and its Remote Control id", () => {
    write("1.json", {
      pid: process.pid,
      sessionId: "rc",
      entrypoint: "sdk-cli",
      bridgeSessionId: "session_01abc",
      procStart: "134401669485577823",
    });
    expect(readRegistry(dir)[0]).toMatchObject({
      entrypoint: "sdk-cli",
      remoteControlId: "session_01abc",
      procStart: "134401669485577823",
    });
  });

  it("returns nothing for a missing folder", () => {
    expect(readRegistry(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("sameProcess", () => {
  const row = { pid: 42, procStart: "100" };

  it("keeps a row until its start time is known to differ", () => {
    expect(sameProcess(row, new Map())).toBe(true);
    expect(sameProcess(row, new Map([["42/100", true]]))).toBe(true);
    expect(sameProcess(row, new Map([["42/100", false]]))).toBe(false);
  });

  it("does not carry a verdict over to a new Claude that reuses the pid", () => {
    expect(sameProcess({ pid: 42, procStart: "200" }, new Map([["42/100", false]]))).toBe(true);
  });
});
