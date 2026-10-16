import { describe, expect, it } from "vitest";
import { formatAge } from "../src/renderer/shared/format.js";

describe("formatAge", () => {
  it("shows seconds under a minute", () => {
    expect(formatAge(5_000)).toBe("5s");
  });

  it("shows whole minutes under an hour", () => {
    expect(formatAge(90_000)).toBe("1m");
  });

  it("shows hours and padded minutes under a day", () => {
    expect(formatAge(3_600_000 + 24 * 60_000)).toBe("1h 24m");
  });

  it("rolls into days past a day", () => {
    expect(formatAge(2 * 86_400_000 + 3 * 3_600_000)).toBe("2d 3h");
  });

  it("rolls into weeks rather than hundreds of hours", () => {
    expect(formatAge(300 * 3_600_000)).toBe("1w 5d");
  });

  it("never reports negative age", () => {
    expect(formatAge(-1000)).toBe("0s");
  });
});
