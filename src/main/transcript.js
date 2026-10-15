import { createReadStream, statSync } from "node:fs";
import { costOf } from "./pricing.js";

// Claude Code's transcript JSONL is documented as internal and may change
// between releases, so this reader only feeds the activity tray: anything it
// does not recognise is skipped, and the card's headline cost never comes
// from here.

const MAX_TURNS = 50;
const POLL_MS = 1000;
const TOOL_ARG_KEYS = ["command", "file_path", "pattern", "path", "query", "url", "prompt", "description"];

function toolSummary(input) {
  if (!input || typeof input !== "object") return "";
  for (const key of TOOL_ARG_KEYS) if (typeof input[key] === "string") return input[key];
  return Object.values(input).find((value) => typeof value === "string") ?? "";
}

function promptText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.some((block) => block.type === "tool_result")) return null;
  const text = content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
  return text || null;
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

// Folds transcript records into per-prompt turns: the prompt, every tool
// call with its duration, and the tokens and estimated cost behind it.
export function createTurnBuilder() {
  const turns = [];
  const seenMessages = new Set();
  const openTools = new Map();

  const current = () => turns[turns.length - 1];

  function startTurn(at, prompt) {
    turns.push({ at, prompt, model: null, tools: [], usage: emptyUsage(), costUsd: 0, durationMs: 0 });
    if (turns.length > MAX_TURNS) turns.shift();
  }

  function userRecord(at, message) {
    const prompt = promptText(message.content);
    if (prompt !== null) {
      startTurn(at, prompt);
      return;
    }
    if (!Array.isArray(message.content)) return;
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const tool = openTools.get(block.tool_use_id);
      if (!tool) continue;
      tool.durationMs = at - tool.at;
      tool.error = block.is_error === true;
      openTools.delete(block.tool_use_id);
    }
  }

  function assistantRecord(at, message) {
    const turn = current();
    if (!turn) return;
    turn.model = message.model ?? turn.model;
    turn.durationMs = Math.max(turn.durationMs, at - turn.at);
    for (const block of message.content ?? []) {
      if (block.type !== "tool_use" || openTools.has(block.id)) continue;
      const tool = {
        id: block.id,
        name: block.name,
        summary: toolSummary(block.input),
        at,
        durationMs: null,
        error: false,
      };
      turn.tools.push(tool);
      openTools.set(block.id, tool);
    }
    // Streamed responses repeat the whole usage object on every block record.
    if (!message.usage || !message.id || seenMessages.has(message.id)) return;
    seenMessages.add(message.id);
    const usage = message.usage;
    turn.usage.input += usage.input_tokens ?? 0;
    turn.usage.output += usage.output_tokens ?? 0;
    turn.usage.cacheRead += usage.cache_read_input_tokens ?? 0;
    turn.usage.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    turn.costUsd += costOf(message.model, usage) ?? 0;
  }

  function push(record) {
    if (!record || typeof record !== "object" || record.isSidechain || record.isMeta) return;
    const message = record.message;
    if (!message || typeof message !== "object") return;
    const at = Date.parse(record.timestamp) || Date.now();
    if (record.type === "user") userRecord(at, message);
    else if (record.type === "assistant") assistantRecord(at, message);
  }

  return { push, turns: () => turns };
}

// Follows a transcript file as it grows. A one-second stat poll is used
// rather than fs.watch, which misses appends on Windows. The callback gets
// the full turn list each time new records arrive.
export function tailTranscript(filePath, onTurns) {
  const builder = createTurnBuilder();
  let offset = 0;
  let remainder = "";
  let reading = false;
  let again = false;

  function consume(chunk) {
    remainder += chunk;
    const lines = remainder.split("\n");
    remainder = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        builder.push(JSON.parse(line));
      } catch {
        // A line this version does not understand.
      }
    }
  }

  function readMore() {
    if (reading) {
      again = true;
      return;
    }
    let size;
    try {
      size = statSync(filePath).size;
    } catch {
      return;
    }
    if (size < offset) {
      offset = 0;
      remainder = "";
    }
    if (size === offset) return;
    reading = true;
    const stream = createReadStream(filePath, { start: offset, end: size - 1, encoding: "utf8" });
    stream.on("data", consume);
    stream.on("error", () => {
      reading = false;
    });
    stream.on("end", () => {
      offset = size;
      reading = false;
      onTurns(builder.turns());
      if (again) {
        again = false;
        readMore();
      }
    });
  }

  const timer = setInterval(readMore, POLL_MS);
  readMore();
  return () => clearInterval(timer);
}
