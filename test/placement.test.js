import { describe, expect, it } from "vitest";
import { computeBounds, pickDisplay } from "../src/main/placement.js";

const displays = [
  { id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { id: 2, primary: false, workArea: { x: 1920, y: -200, width: 2560, height: 1400 } },
];

describe("pickDisplay", () => {
  it("matches the profile's monitor id, falling back to the primary display", () => {
    expect(pickDisplay(displays, "2").id).toBe(2);
    expect(pickDisplay(displays, 999).id).toBe(1);
    expect(pickDisplay(displays, undefined).id).toBe(1);
  });
});

describe("computeBounds", () => {
  it("centres a medium window on the primary display by default", () => {
    expect(computeBounds({}, displays)).toEqual({ x: 320, y: 120, width: 1280, height: 800, displayId: 1 });
  });

  it("anchors to a corner of the chosen display", () => {
    const bounds = computeBounds({ monitor: 2, size: { preset: "small" }, position: "se" }, displays);
    expect(bounds).toEqual({ x: 1920 + 2560 - 1000, y: -200 + 1400 - 650, width: 1000, height: 650, displayId: 2 });
    expect(computeBounds({ position: "nw" }, displays)).toMatchObject({ x: 0, y: 0 });
    expect(computeBounds({ position: "n" }, displays)).toMatchObject({ x: 320, y: 0 });
  });

  it("fills the work area for the full preset and clamps custom sizes", () => {
    expect(computeBounds({ size: { preset: "full" } }, displays)).toMatchObject({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
    });
    expect(computeBounds({ size: { preset: "custom", width: 9000, height: 100 } }, displays)).toMatchObject({
      width: 1920,
      height: 240,
    });
    expect(computeBounds({ size: { preset: "custom", width: "abc" } }, displays).width).toBe(1280);
  });

  it("shrinks a preset that would not fit the display", () => {
    const small = [{ id: 7, primary: true, workArea: { x: 0, y: 0, width: 1024, height: 700 } }];
    expect(computeBounds({ size: { preset: "large" } }, small)).toMatchObject({ width: 1024, height: 700 });
  });
});
