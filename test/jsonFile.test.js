import { mkdtempSync, readFileSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../src/main/jsonFile.js";

function failing(code, times) {
  let calls = 0;
  const rename = (from, to) => {
    calls += 1;
    if (calls <= times) throw Object.assign(new Error(`${code}: busy`), { code });
    renameSync(from, to);
  };
  return { rename, calls: () => calls };
}

describe("writeJsonAtomic", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hekaton-json-"));
  const file = path.join(dir, "state.json");
  const waits = [];
  const wait = (ms) => waits.push(ms);

  it("writes the value", () => {
    writeJsonAtomic(file, { a: 1 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ a: 1 });
  });

  it("retries a rename refused while the file is busy", () => {
    waits.length = 0;
    const busy = failing("EPERM", 3);
    writeJsonAtomic(file, { b: 2 }, { rename: busy.rename, wait });
    expect(busy.calls()).toBe(4);
    expect(waits).toEqual([10, 25, 50]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ b: 2 });
  });

  it("gives up once the retries run out", () => {
    const busy = failing("EBUSY", 99);
    expect(() => writeJsonAtomic(file, { c: 3 }, { rename: busy.rename, wait })).toThrow("EBUSY");
    expect(busy.calls()).toBe(7);
  });

  it("does not retry any other failure", () => {
    const missing = failing("ENOENT", 1);
    expect(() => writeJsonAtomic(file, { d: 4 }, { rename: missing.rename, wait })).toThrow("ENOENT");
    expect(missing.calls()).toBe(1);
  });
});
