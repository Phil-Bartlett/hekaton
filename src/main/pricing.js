// List prices in USD per million tokens, from platform.claude.com/docs
// pricing on 2026-10-15: [pattern, input, output, cache-hit multiple of input].
// Cache writes are 1.25x input for the 5-minute TTL and 2x for the 1-hour
// TTL. Figures are API-equivalent estimates, not a subscription invoice.
const RATES = [
  [/^claude-(fable|mythos)-5-1/, 10, 50, 0.025],
  [/^claude-(fable|mythos)-5/, 10, 50, 0.1],
  [/^claude-opus-5-5/, 4, 20, 0.05],
  [/^claude-opus-(5|4-8|4-7|4-6|4-5)/, 5, 25, 0.1],
  [/^claude-sonnet-5-5/, 2, 10, 0.05],
  [/^claude-sonnet-5/, 2, 10, 0.1],
  [/^claude-sonnet-4/, 3, 15, 0.1],
  [/^claude-haiku-5-5/, 0.1, 0.5, 0.1],
  [/^claude-haiku-4-5/, 1, 5, 0.1],
];

// Haiku 5.5 charges a higher tier once the prompt passes 100k tokens.
const HAIKU_55_LONG_PROMPT = { threshold: 100_000, input: 0.5, output: 2.5 };

const MILLION = 1_000_000;

export function rateFor(model, promptTokens = 0) {
  const row = RATES.find(([pattern]) => pattern.test(model ?? ""));
  if (!row) return null;
  const [pattern, baseInput, baseOutput, hitMultiple] = row;
  const longPrompt = pattern.source.includes("haiku-5-5") && promptTokens > HAIKU_55_LONG_PROMPT.threshold;
  const input = longPrompt ? HAIKU_55_LONG_PROMPT.input : baseInput;
  const output = longPrompt ? HAIKU_55_LONG_PROMPT.output : baseOutput;
  return { input, output, cacheHit: input * hitMultiple, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2 };
}

// `usage` is the API usage object: input_tokens, output_tokens,
// cache_read_input_tokens, cache_creation_input_tokens and, when the API
// reports it, cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}.
export function costOf(model, usage) {
  if (!usage) return null;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = usage.cache_creation ? (usage.cache_creation.ephemeral_5m_input_tokens ?? 0) : cacheWrite;
  const rate = rateFor(model, input + cacheRead + cacheWrite);
  if (!rate) return null;
  return (
    (input * rate.input +
      output * rate.output +
      cacheRead * rate.cacheHit +
      write5m * rate.cacheWrite5m +
      write1h * rate.cacheWrite1h) /
    MILLION
  );
}
