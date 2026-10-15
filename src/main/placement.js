// Where a new session window goes: which display, how big, and which of
// the nine anchor positions inside that display's work area.

export const SIZE_PRESETS = Object.freeze({
  tiny: [800, 500],
  small: [1000, 650],
  medium: [1280, 800],
  large: [1600, 1000],
});

const MIN_WIDTH = 480;
const MIN_HEIGHT = 240;

// Column and row index (0..2) for each anchor.
const ANCHORS = Object.freeze({
  nw: [0, 0],
  n: [1, 0],
  ne: [2, 0],
  w: [0, 1],
  center: [1, 1],
  e: [2, 1],
  sw: [0, 2],
  s: [1, 2],
  se: [2, 2],
});

export const POSITIONS = Object.keys(ANCHORS);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function pickDisplay(displays, monitor) {
  return (
    displays.find((display) => String(display.id) === String(monitor)) ??
    displays.find((display) => display.primary) ??
    displays[0]
  );
}

function sizeFor(size, area) {
  if (size?.preset === "full") return [area.width, area.height];
  if (size?.preset === "custom") {
    return [
      clamp(Number(size.width) || SIZE_PRESETS.medium[0], MIN_WIDTH, area.width),
      clamp(Number(size.height) || SIZE_PRESETS.medium[1], MIN_HEIGHT, area.height),
    ];
  }
  const [width, height] = SIZE_PRESETS[size?.preset] ?? SIZE_PRESETS.medium;
  return [Math.min(width, area.width), Math.min(height, area.height)];
}

export function computeBounds(profile, displays) {
  const display = pickDisplay(displays, profile.monitor);
  const area = display.workArea;
  const [width, height] = sizeFor(profile.size, area);
  const [col, row] = ANCHORS[profile.position] ?? ANCHORS.center;
  const x = area.x + [0, (area.width - width) / 2, area.width - width][col];
  const y = area.y + [0, (area.height - height) / 2, area.height - height][row];
  return { x: Math.round(x), y: Math.round(y), width, height, displayId: display.id };
}
