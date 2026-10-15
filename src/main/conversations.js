import { openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { claudeHome } from "./claudeConfig.js";

// Conversations Claude Code has on disk, whoever started them: one JSONL
// transcript per session under ~/.claude/projects/<project>/. Only the head
// of each file is read (transcripts run to hundreds of MB), which is where
// the working directory, the first prompt and the AI title live.

const HEAD_BYTES = 512 * 1024;
const MAX_RESULTS = 300;
const SYSTEM_RECORD = /^\s*<(local-command|command-|task-notification|system-reminder|bash-(stdout|stderr|input))/;

function readHead(file) {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const bytes = readSync(fd, buffer, 0, HEAD_BYTES, 0);
    return buffer.toString("utf8", 0, bytes);
  } finally {
    closeSync(fd);
  }
}

function promptOf(record) {
  const content = record.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text)
            .join("\n")
        : "";
  return text.trim() && !SYSTEM_RECORD.test(text) ? text : null;
}

// What the head of a transcript tells us; null when it holds no prompt at all.
export function summariseTranscript(text) {
  let cwd = null;
  let firstPrompt = null;
  let title = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // the last line of the head is usually cut mid-record
    }
    if (record.type === "ai-title" && typeof record.aiTitle === "string") title = record.aiTitle;
    if (record.type === "custom-title" && typeof record.customTitle === "string") title = record.customTitle;
    if (record.type === "user" && !record.isSidechain && !record.isMeta) {
      cwd ??= record.cwd ?? null;
      firstPrompt ??= promptOf(record);
    }
    if (cwd && firstPrompt && title) break;
  }
  return firstPrompt ? { cwd, firstPrompt, title } : null;
}

export function listConversations({ home = claudeHome(), exclude = new Set() } = {}) {
  const root = path.join(home, "projects");
  let projects;
  try {
    projects = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const found = [];
  for (const project of projects) {
    const dir = path.join(root, project.name);
    let files;
    try {
      files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const name of files) {
      const sessionId = name.slice(0, -".jsonl".length);
      if (exclude.has(sessionId)) continue;
      const file = path.join(dir, name);
      try {
        const stat = statSync(file);
        found.push({ sessionId, file, modifiedAt: stat.mtimeMs, size: stat.size });
      } catch {
        // Removed between listing and stat.
      }
    }
  }
  found.sort((a, b) => b.modifiedAt - a.modifiedAt);
  const results = [];
  for (const entry of found) {
    if (results.length >= MAX_RESULTS) break;
    let summary;
    try {
      summary = summariseTranscript(readHead(entry.file));
    } catch {
      continue;
    }
    if (summary) results.push({ ...entry, ...summary });
  }
  return results;
}
