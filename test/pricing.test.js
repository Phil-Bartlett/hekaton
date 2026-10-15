import { describe, expect, it } from "vitest";
import { costOf, rateFor } from "../src/main/pricing.js";

describe("rateFor", () => {
  it("prices Fable 5.1 cache hits at 2.5% of input", () => {
    expect(rateFor("claude-fable-5-1")).toEqual({
      input: 10,
      output: 50,
      cacheHit: 0.25,
      cacheWrite5m: 12.5,
      cacheWrite1h: 20,
    });
  });

  it("uses the long-prompt tier for Haiku 5.5 past 100k tokens", () => {
    expect(rateFor("claude-haiku-5-5", 50_000).input).toBe(0.1);
    expect(rateFor("claude-haiku-5-5", 150_000)).toMatchObject({ input: 0.5, output: 2.5, cacheHit: 0.05 });
  });

  it("returns null for an unknown model", () => {
    expect(rateFor("claude-unknown-9")).toBeNull();
  });
});

describe("costOf", () => {
  it("sums every token class at Opus 5.5 rates", () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 2_000_000,
      cache_creation_input_tokens: 400_000,
    };
    // 4 + 2 + 2 * 0.2 + 0.4 * 5
    expect(costOf("claude-opus-5-5", usage)).toBeCloseTo(8.4, 6);
  });

  it("prices 1-hour cache writes at 2x when the breakdown is present", () => {
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 },
    };
    expect(costOf("claude-sonnet-5-5", usage)).toBeCloseTo(4, 6);
  });

  it("returns null without usage or for an unpriced model", () => {
    expect(costOf("claude-opus-5-5", null)).toBeNull();
    expect(costOf("mystery", { input_tokens: 1 })).toBeNull();
  });
});
