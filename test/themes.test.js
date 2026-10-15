import { describe, expect, it } from "vitest";
import { contrastRatio, mix, readableOn } from "../src/renderer/shared/color.js";
import { deriveVariables, THEMES, themeIssues } from "../src/renderer/shared/themes.js";

describe("colour maths", () => {
  it("matches the WCAG reference ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(readableOn("#f59e0b")).toBe("#000000");
    expect(readableOn("#374151")).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("built-in themes", () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    it(`${name} meets AA contrast everywhere text is drawn`, () => {
      expect(themeIssues(theme)).toEqual([]);
    });
  }

  it("derives every grey the stylesheets rely on", () => {
    const vars = deriveVariables(THEMES.light);
    for (const name of [
      "--surface",
      "--control",
      "--control-hover",
      "--border",
      "--border-strong",
      "--track",
      "--tray",
    ]) {
      expect(vars[name]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(contrastRatio(THEMES.light.fg, vars["--control"])).toBeGreaterThan(4.5);
    expect(contrastRatio(THEMES.dark.fg, deriveVariables(THEMES.dark)["--control"])).toBeGreaterThan(4.5);
  });

  it("reports a theme whose muted text is too faint", () => {
    const issues = themeIssues({ ...THEMES.dark, fgMuted: "#555555" });
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/^Muted text on background is \d\.\d:1, needs 4\.5:1$/);
    expect(issues[1]).toMatch(/^Muted text on panels is \d\.\d:1, needs 4\.5:1$/);
  });
});
