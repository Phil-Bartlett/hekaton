import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listConversations, summariseTranscript } from "../src/main/conversations.js";

const line = (record) => `${JSON.stringify(record)}\n`;
const user = (text, extra = {}) =>
  line({ type: "user", cwd: "C:/proj", message: { role: "user", content: text }, ...extra });

describe("summariseTranscript", () => {
  it("takes the folder, the first typed prompt and the AI title from the head", () => {
    const head =
      line({ type: "mode", mode: "normal" }) +
      user("<local-command-stdout>noise</local-command-stdout>") +
      user("fix the login bug") +
      line({ type: "assistant", message: { role: "assistant", content: [] } }) +
      line({ type: "ai-title", aiTitle: "Login bug fix" }) +
      '{"type":"user","message":{"content":"cut mid-rec';
    expect(summariseTranscript(head)).toEqual({
      cwd: "C:/proj",
      firstPrompt: "fix the login bug",
      title: "Login bug fix",
    });
  });

  it("returns null when no prompt was ever typed", () => {
    expect(summariseTranscript(line({ type: "mode" }) + user("<task-notification>x</task-notification>"))).toBeNull();
  });
});

describe("listConversations", () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "hekaton-conv-"));
    const project = path.join(home, "projects", "C--proj");
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(project, "aaaa.jsonl"), user("older prompt"));
    writeFileSync(
      path.join(project, "bbbb.jsonl"),
      user("newer prompt") + line({ type: "ai-title", aiTitle: "Newer" }),
    );
    writeFileSync(path.join(project, "cccc.jsonl"), user("already known"));
    writeFileSync(path.join(project, "empty.jsonl"), line({ type: "mode" }));
    const old = new Date(Date.now() - 86_400_000);
    utimesSync(path.join(project, "aaaa.jsonl"), old, old);
  });

  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("lists conversations newest first, skipping known ids and promptless files", () => {
    const rows = listConversations({ home, exclude: new Set(["cccc"]) });
    expect(rows.map((row) => row.sessionId)).toEqual(["bbbb", "aaaa"]);
    expect(rows[0]).toMatchObject({ title: "Newer", firstPrompt: "newer prompt", cwd: "C:/proj" });
    expect(rows[0].file.endsWith("bbbb.jsonl")).toBe(true);
  });

  it("returns nothing without a projects folder", () => {
    expect(listConversations({ home: path.join(home, "nope") })).toEqual([]);
  });
});
