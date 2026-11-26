import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { claudeHome } from "./claudeConfig.js";
import { tailTranscript } from "./transcript.js";

const NOTIFY_MS = 500;

// A conversation's transcript, found by its id. The folder is Claude's own
// encoding of the working directory, so it is looked up rather than rebuilt.
// Null until the conversation has had its first prompt.
export function findTranscript(sessionId, home = claudeHome()) {
  const root = path.join(home, "projects");
  let projects;
  try {
    projects = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return null;
  }
  for (const project of projects) {
    const file = path.join(root, project.name, `${sessionId}.jsonl`);
    if (existsSync(file)) return file;
  }
  return null;
}

// A registry row with what its transcript adds. No hooks or statusline reach
// a session Hekaton did not launch, so the cost is the pricing-table estimate
// and the state stays the registry's own idle / busy.
export function externalView(row, activity) {
  return {
    ...row,
    title: activity?.title ?? null,
    lastPrompt: activity?.turns.at(-1)?.prompt ?? null,
    totalCostUsd: activity?.totalCostUsd ?? 0,
    links: activity?.links ?? [],
  };
}

// Follows the transcript of every session running outside Hekaton, among them
// the headless children of `claude remote-control`, which have no terminal to
// attach to. `onChange()` fires, coalesced, when any of them has moved on.
export function createExternalTails(onChange, { find = findTranscript, tail = tailTranscript } = {}) {
  const tails = new Map();
  let timer = null;

  function notify() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, NOTIFY_MS);
  }

  // Called with the current rows whenever the registry changes.
  function sync(rows) {
    const wanted = new Set(rows.map((row) => row.sessionId));
    for (const [sessionId, entry] of tails) {
      if (wanted.has(sessionId)) continue;
      entry.stop?.();
      tails.delete(sessionId);
    }
    for (const sessionId of wanted) {
      const entry = tails.get(sessionId) ?? { stop: null, activity: null };
      tails.set(sessionId, entry);
      if (entry.stop) continue;
      const file = find(sessionId);
      if (!file) continue;
      entry.stop = tail(file, (activity) => {
        entry.activity = activity;
        notify();
      });
    }
  }

  function view(row) {
    return externalView(row, tails.get(row.sessionId)?.activity);
  }

  return { sync, view };
}
