import { describe, expect, it } from "vitest";
import { createTurnBuilder } from "../src/main/transcript.js";

const T0 = "2026-10-15T08:00:00.000Z";
const at = (seconds) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

const usage = {
  input_tokens: 10,
  output_tokens: 100,
  cache_read_input_tokens: 1_000_000,
  cache_creation_input_tokens: 0,
};

const user = (seconds, content, extra = {}) => ({
  type: "user",
  timestamp: at(seconds),
  message: { role: "user", content },
  ...extra,
});
const assistant = (seconds, id, block) => ({
  type: "assistant",
  timestamp: at(seconds),
  message: { id, model: "claude-opus-5-5", role: "assistant", content: [block], usage },
});

describe("createTurnBuilder", () => {
  it("builds one turn per prompt with tools, durations, tokens and cost", () => {
    const builder = createTurnBuilder();
    builder.push(user(0, "list the files"));
    builder.push(assistant(1, "msg_1", { type: "thinking", thinking: "…" }));
    builder.push(
      assistant(1, "msg_1", {
        type: "tool_use",
        id: "toolu_1",
        name: "Bash",
        input: { command: "ls -la", description: "List" },
      }),
    );
    builder.push(user(3, [{ type: "tool_result", tool_use_id: "toolu_1", content: "total 0", is_error: false }]));
    builder.push(assistant(5, "msg_2", { type: "text", text: "Done." }));
    builder.push(user(9, "thanks"));

    const turns = builder.turns();
    expect(turns).toHaveLength(2);
    const [first, second] = turns;
    expect(first.prompt).toBe("list the files");
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.tools).toEqual([
      { id: "toolu_1", name: "Bash", summary: "ls -la", at: Date.parse(at(1)), durationMs: 2000, error: false },
    ]);
    // Usage counted once per message id although msg_1 arrived as two records.
    expect(first.usage).toEqual({ input: 20, output: 200, cacheRead: 2_000_000, cacheWrite: 0 });
    // Per message: 10 * 4 + 100 * 20 + 1_000_000 * 0.2 = 0.20204 USD, twice.
    expect(first.costUsd).toBeCloseTo(0.40408, 6);
    expect(first.durationMs).toBe(5000);
    expect(second.prompt).toBe("thanks");
    expect(second.tools).toEqual([]);
  });

  it("reads prompts sent as text blocks and ignores meta and sidechain records", () => {
    const builder = createTurnBuilder();
    builder.push(
      user(0, [
        { type: "text", text: "with an image" },
        { type: "image", source: {} },
      ]),
    );
    builder.push(user(1, "subagent prompt", { isSidechain: true }));
    builder.push(user(2, "caveat", { isMeta: true }));
    builder.push({ type: "file-history-snapshot", timestamp: at(3) });
    builder.push("not an object");
    expect(builder.turns().map((turn) => turn.prompt)).toEqual(["with an image"]);
  });

  it("marks a failed tool result and leaves unmatched results alone", () => {
    const builder = createTurnBuilder();
    builder.push(user(0, "go"));
    builder.push(
      assistant(1, "msg_1", { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "C:/x" } }),
    );
    builder.push(user(2, [{ type: "tool_result", tool_use_id: "toolu_1", content: "nope", is_error: true }]));
    builder.push(user(3, [{ type: "tool_result", tool_use_id: "toolu_unknown", content: "" }]));
    const [turn] = builder.turns();
    expect(turn.tools[0]).toMatchObject({ name: "Read", summary: "C:/x", durationMs: 1000, error: true });
  });

  it("keeps only the most recent fifty turns", () => {
    const builder = createTurnBuilder();
    for (let i = 0; i < 60; i += 1) builder.push(user(i, `prompt ${i}`));
    const turns = builder.turns();
    expect(turns).toHaveLength(50);
    expect(turns[0].prompt).toBe("prompt 10");
  });
});
