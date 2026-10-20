import { renameSync, writeFileSync } from "node:fs";

// Windows refuses to rename over a file that anything else holds open, and
// virus scanners and the search indexer open a freshly written file for a
// moment; those refusals clear on their own within a second or so.
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
const RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400];

// Synchronous, because the last save runs while the app is quitting.
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Write-then-rename so a crash mid-write never leaves a truncated file. A
// rename refused because the file is busy is retried; any other failure, or
// one that outlasts the retries, is thrown.
export function writeJsonAtomic(file, value, { rename = renameSync, wait = pause } = {}) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(tmp, file);
      return;
    } catch (error) {
      if (!BUSY.has(error.code) || attempt >= RETRY_DELAYS_MS.length) throw error;
      wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}
