import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExternalTails, externalView, findTranscript } from "../src/main/external.js";

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "hekaton-external-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("findTranscript", () => {
  it("finds a transcript by session id in whichever project folder holds it", () => {
    mkdirSync(path.join(home, "projects", "C--a"), { recursive: true });
    mkdirSync(path.join(home, "projects", "C--b"), { recursive: true });
    const file = path.join(home, "projects", "C--b", "abc.jsonl");
    writeFileSync(file, "");
    expect(findTranscript("abc", home)).toBe(file);
    expect(findTranscript("missing", home)).toBeNull();
  });

  it("returns null when there is no projects folder", () => {
    expect(findTranscript("abc", home)).toBeNull();
  });
});

describe("externalView", () => {
  const row = { pid: 1, sessionId: "abc", status: "busy" };

  it("adds nothing but blanks before the transcript has been read", () => {
    expect(externalView(row, undefined)).toEqual({ ...row, title: null, lastPrompt: null, totalCostUsd: 0, links: [] });
  });

  it("takes the title, last prompt, cost and links from the transcript", () => {
    const activity = {
      title: "Fix the build",
      turns: [{ prompt: "first" }, { prompt: "second" }],
      totalCostUsd: 1.5,
      links: [{ url: "https://github.com/a/b/pull/1", kind: "pr" }],
    };
    expect(externalView(row, activity)).toMatchObject({
      title: "Fix the build",
      lastPrompt: "second",
      totalCostUsd: 1.5,
      links: activity.links,
    });
  });
});

describe("createExternalTails", () => {
  it("tails each session once its transcript exists and stops when the session goes", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stops = { a: vi.fn(), b: vi.fn() };
    const feeds = {};
    const files = { a: "a.jsonl" };
    const tails = createExternalTails(onChange, {
      find: (sessionId) => files[sessionId] ?? null,
      tail: (file, onActivity) => {
        const id = file[0];
        feeds[id] = onActivity;
        return stops[id];
      },
    });
    const rows = [{ sessionId: "a" }, { sessionId: "b" }];

    tails.sync(rows);
    expect(Object.keys(feeds)).toEqual(["a"]);

    files.b = "b.jsonl";
    tails.sync(rows);
    expect(Object.keys(feeds)).toEqual(["a", "b"]);

    feeds.a({ title: "A", turns: [{ prompt: "hello" }], totalCostUsd: 2, links: [] });
    feeds.a({ title: "A", turns: [{ prompt: "again" }], totalCostUsd: 3, links: [] });
    vi.runAllTimers();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(tails.view(rows[0])).toMatchObject({ lastPrompt: "again", totalCostUsd: 3 });
    expect(tails.view(rows[1]).lastPrompt).toBeNull();

    tails.sync([rows[1]]);
    expect(stops.a).toHaveBeenCalledTimes(1);
    expect(stops.b).not.toHaveBeenCalled();
    expect(tails.view(rows[0]).lastPrompt).toBeNull();
  });
});
