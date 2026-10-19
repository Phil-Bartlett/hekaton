// Rectangles for laying session windows out side by side inside one
// display's work area. Pure, so the arithmetic is tested without Electron.

import { MIN_HEIGHT, MIN_WIDTH } from "./placement.js";

export const TILE_LAYOUTS = Object.freeze(["grid", "columns", "rows", "main"]);

export const DEFAULT_GAP = 8;
const MAIN_RATIO = 0.6;
// Terminals read best a little wider than tall; the grid aims for tiles
// near this shape.
const TARGET_ASPECT = 1.6;

// `parts` spans along one axis with `gap` between them and at both ends.
// Edges are rounded from the exact positions so the spans meet without drift.
function split(start, length, parts, gap) {
  const usable = length - gap * (parts + 1);
  return Array.from({ length: parts }, (_, i) => {
    const from = Math.round(start + gap * (i + 1) + (usable * i) / parts);
    const to = Math.round(start + gap * (i + 1) + (usable * (i + 1)) / parts);
    return [from, to - from];
  });
}

function rect([x, width], [y, height]) {
  return { x, y, width, height };
}

function fits(width, height) {
  return width >= MIN_WIDTH && height >= MIN_HEIGHT;
}

// Columns for a grid of `count`: the shape closest to TARGET_ASPECT among
// those whose tiles stay above the window minimum, or failing that the one
// that comes nearest to it (those windows will overlap).
function gridColumns(count, area, gap) {
  let best = null;
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const width = (area.width - gap * (cols + 1)) / cols;
    const height = (area.height - gap * (rows + 1)) / rows;
    const candidate = {
      cols,
      fits: fits(width, height),
      shortfall: Math.max(MIN_WIDTH - width, 0) + Math.max(MIN_HEIGHT - height, 0),
      // Empty cells in the last row cost as much as a poor shape.
      score: Math.abs(Math.log(width / height / TARGET_ASPECT)) + (rows * cols - count) / count,
    };
    const better =
      !best ||
      (candidate.fits && !best.fits) ||
      (candidate.fits === best.fits &&
        (candidate.fits ? candidate.score < best.score : candidate.shortfall < best.shortfall));
    if (better) best = candidate;
  }
  return best.cols;
}

function grid(count, area, gap) {
  const cols = gridColumns(count, area, gap);
  const rows = Math.ceil(count / cols);
  const rowSpans = split(area.y, area.height, rows, gap);
  const rects = [];
  for (let row = 0; row < rows; row += 1) {
    // A short last row stretches across the full width.
    const inRow = Math.min(cols, count - row * cols);
    for (const colSpan of split(area.x, area.width, inRow, gap)) rects.push(rect(colSpan, rowSpans[row]));
  }
  return rects;
}

function columns(count, area, gap) {
  const rowSpan = split(area.y, area.height, 1, gap)[0];
  return split(area.x, area.width, count, gap).map((colSpan) => rect(colSpan, rowSpan));
}

function rows(count, area, gap) {
  const colSpan = split(area.x, area.width, 1, gap)[0];
  return split(area.y, area.height, count, gap).map((rowSpan) => rect(colSpan, rowSpan));
}

// The first window takes MAIN_RATIO of the width; the rest stack beside it.
function main(count, area, gap) {
  const usable = area.width - gap * 3;
  const mainWidth = Math.round(usable * MAIN_RATIO);
  const mainSpan = [area.x + gap, mainWidth];
  const stackX = area.x + gap * 2 + mainWidth;
  const stackSpan = [stackX, area.x + area.width - gap - stackX];
  const fullHeight = split(area.y, area.height, 1, gap)[0];
  return [
    rect(mainSpan, fullHeight),
    ...split(area.y, area.height, count - 1, gap).map((rowSpan) => rect(stackSpan, rowSpan)),
  ];
}

// Every layout but the grid gives up to the grid once its tiles would fall
// below the window minimum, rather than overlap.
export function tileRects(count, area, { layout = "grid", gap = DEFAULT_GAP } = {}) {
  if (count <= 0) return [];
  if (count === 1) return columns(1, area, gap);
  const candidate = { columns, rows, main }[layout]?.(count, area, gap);
  if (candidate && candidate.every(({ width, height }) => fits(width, height))) return candidate;
  return grid(count, area, gap);
}
