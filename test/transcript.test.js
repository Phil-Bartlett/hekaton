import { describe, expect, it } from "vitest";
import { collectLinks, createTurnBuilder } from "../src/main/transcript.js";

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
    builder.push(user(2.5, "<local-command-stdout>Set effort level to high</local-command-stdout>"));
    builder.push(user(2.6, "<task-notification>\n<task-id>x</task-id>\n</task-notification>"));
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

  it("marks a turn unpriced when the model is unknown", () => {
    const builder = createTurnBuilder();
    builder.push(user(0, "go"));
    const record = assistant(1, "msg_1", { type: "text", text: "ok" });
    record.message.model = "claude-mystery-9";
    builder.push(record);
    expect(builder.turns()[0]).toMatchObject({ unpriced: true, costUsd: 0 });
  });

  it("keeps only the most recent fifty turns", () => {
    const builder = createTurnBuilder();
    for (let i = 0; i < 60; i += 1) builder.push(user(i, `prompt ${i}`));
    const turns = builder.turns();
    expect(turns).toHaveLength(50);
    expect(turns[0].prompt).toBe("prompt 10");
  });

  it("banks the cost of dropped turns into the whole-session summary", () => {
    const builder = createTurnBuilder();
    let second = 0;
    for (let i = 0; i < 60; i += 1) {
      builder.push(user((second += 1), `prompt ${i}`));
      builder.push(assistant((second += 1), `msg_${i}`, { type: "text", text: "ok" }));
    }
    const perTurn = builder.turns()[0].costUsd;
    const summary = builder.summary();
    expect(summary.droppedTurns).toBe(10);
    expect(summary.unpriced).toBe(false);
    // Sixty turns of equal cost, whether still shown or aged out of the window.
    expect(summary.totalCostUsd).toBeCloseTo(perTurn * 60, 9);
  });

  it("marks the summary unpriced once any turn used an unknown model", () => {
    const builder = createTurnBuilder();
    builder.push(user(0, "go"));
    const record = assistant(1, "msg_x", { type: "text", text: "ok" });
    record.message.model = "claude-mystery-9";
    builder.push(record);
    expect(builder.summary().unpriced).toBe(true);
  });

  it("takes the session title from ai-title, and a user rename overrides it", () => {
    const builder = createTurnBuilder();
    builder.push(user(0, "go"));
    builder.push({ type: "ai-title", aiTitle: "Login bug fix" });
    expect(builder.summary().title).toBe("Login bug fix");
    builder.push({ type: "custom-title", customTitle: "Auth work" });
    expect(builder.summary().title).toBe("Auth work");
  });

  it("collects artifact and PR links from assistant text and tool results, deduped", () => {
    const builder = createTurnBuilder();
    builder.push(user(0, "build it"));
    builder.push(
      assistant(1, "msg_1", {
        type: "text",
        text: "Published at https://claude.ai/code/artifact/abc123 and opened https://github.com/me/app/pull/42.",
      }),
    );
    builder.push(
      user(2, [
        { type: "tool_result", tool_use_id: "t1", content: "see https://claude.ai/code/artifact/abc123 again" },
      ]),
    );
    expect(builder.links()).toEqual([
      { url: "https://claude.ai/code/artifact/abc123", kind: "artifact" },
      { url: "https://github.com/me/app/pull/42", kind: "pr" },
    ]);
  });
});

describe("collectLinks", () => {
  it("trims trailing prose punctuation and ignores unrelated urls", () => {
    const links = new Map();
    collectLinks("done (https://claude.ai/artifact/xy-9), not http://localhost:5050/api/health", links);
    expect([...links.values()]).toEqual([{ url: "https://claude.ai/artifact/xy-9", kind: "artifact" }]);
  });
});
