import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

const MAX_ENTRIES = 200;

// One line per finished session, newest last on disk, newest first when read.
export function createHistory({ dir }) {
  const file = path.join(dir, "history.jsonl");

  function record(entry) {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  }

  function list() {
    let lines;
    try {
      lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
    const entries = [];
    for (const line of lines.slice(-MAX_ENTRIES)) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // A truncated line from an interrupted write.
      }
    }
    return entries.reverse();
  }

  return { record, list };
}
