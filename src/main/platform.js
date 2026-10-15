import { app } from "electron";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const IS_MAC = process.platform === "darwin";
export const IS_WINDOWS = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";

// Files shipped next to the app: the project root in development (the main
// bundle sits in dist/), the resources folder once packaged.
export function resourcePath(...segments) {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return path.join(base, ...segments);
}

// The native installer puts the binary in ~/.local/bin on every platform;
// any other install (npm global, Homebrew) is found through PATH, unless the
// user pointed Settings at a specific executable.
export function claudeBinary(override) {
  if (override && existsSync(override)) return override;
  const native = path.join(os.homedir(), ".local", "bin", IS_WINDOWS ? "claude.exe" : "claude");
  return existsSync(native) ? native : "claude";
}

// The title bar is ours on every platform. macOS keeps its traffic lights,
// inset to sit on the bar; Windows and Linux get caption buttons drawn by the
// renderer, because the native overlay paints an opaque box that cuts the
// accent frame at the corner. Linux ignores titleBarStyle, so it gets a plain
// frameless window instead.
export function titleBarOptions({ height }) {
  if (IS_MAC) {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 12, y: Math.round((height - 14) / 2) },
    };
  }
  if (IS_LINUX) return { frame: false };
  return { titleBarStyle: "hidden" };
}
