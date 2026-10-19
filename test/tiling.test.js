import { describe, expect, it } from "vitest";
import { MIN_HEIGHT, MIN_WIDTH } from "../src/main/placement.js";
import { TILE_LAYOUTS, tileRects } from "../src/main/tiling.js";

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const offsetArea = { x: 1920, y: -200, width: 2560, height: 1400 };

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("tileRects", () => {
  it("gives one window the whole area inside the gap", () => {
    expect(tileRects(1, area)).toEqual([{ x: 8, y: 8, width: 1904, height: 1024 }]);
  });

  it("puts two windows side by side in a grid", () => {
    expect(tileRects(2, area)).toEqual([
      { x: 8, y: 8, width: 948, height: 1024 },
      { x: 964, y: 8, width: 948, height: 1024 },
    ]);
  });

  it("stretches a short last row across the full width", () => {
    const rects = tileRects(3, area);
    expect(rects.slice(0, 2).map((r) => r.width)).toEqual([948, 948]);
    expect(rects[2]).toEqual({ x: 8, y: 524, width: 1904, height: 508 });
  });

  it("gives the main window 60% beside a stack", () => {
    const [main, ...stack] = tileRects(3, area, { layout: "main" });
    expect(main).toEqual({ x: 8, y: 8, width: 1138, height: 1024 });
    expect(stack).toEqual([
      { x: 1154, y: 8, width: 758, height: 508 },
      { x: 1154, y: 524, width: 758, height: 508 },
    ]);
  });

  it("falls back to the grid when columns would be narrower than a window can be", () => {
    expect(tileRects(5, area, { layout: "columns" })).toEqual(tileRects(5, area, { layout: "grid" }));
    expect(tileRects(3, area, { layout: "columns" }).every((r) => r.height === 1024)).toBe(true);
  });

  it("honours the gap setting, including no gap", () => {
    expect(tileRects(2, area, { gap: 0 })).toEqual([
      { x: 0, y: 0, width: 960, height: 1040 },
      { x: 960, y: 0, width: 960, height: 1040 },
    ]);
  });

  it("returns nothing for no windows", () => {
    expect(tileRects(0, area)).toEqual([]);
  });

  for (const layout of TILE_LAYOUTS) {
    it(`${layout}: one rect per window, inside the area, never overlapping`, () => {
      for (const target of [area, offsetArea]) {
        for (let count = 1; count <= 9; count += 1) {
          const rects = tileRects(count, target, { layout });
          expect(rects).toHaveLength(count);
          for (const r of rects) {
            expect(r.x).toBeGreaterThanOrEqual(target.x);
            expect(r.y).toBeGreaterThanOrEqual(target.y);
            expect(r.x + r.width).toBeLessThanOrEqual(target.x + target.width);
            expect(r.y + r.height).toBeLessThanOrEqual(target.y + target.height);
            expect(r.width).toBeGreaterThanOrEqual(MIN_WIDTH);
            expect(r.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
          }
          rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
        }
      }
    });
  }

  it("still places every window when the display is too small to fit them", () => {
    expect(tileRects(20, area)).toHaveLength(20);
  });
});
