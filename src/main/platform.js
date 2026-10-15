import { app } from "electron";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
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

// The app icon: shipped next to the resources once packaged, under build/ in
// development.
export function iconPath() {
  return app.isPackaged ? resourcePath("icon.png") : resourcePath("build", "icon.png");
}

// Start with the user's session. Electron covers Windows and macOS; Linux
// desktops read an XDG autostart entry instead.
export function setLaunchAtLogin(enabled) {
  if (IS_LINUX) {
    const dir = path.join(os.homedir(), ".config", "autostart");
    const file = path.join(dir, "hekaton.desktop");
    if (!enabled) {
      try {
        unlinkSync(file);
      } catch {
        // Nothing to remove.
      }
      return;
    }
    mkdirSync(dir, { recursive: true });
    const exec = process.env.APPIMAGE ?? process.execPath;
    writeFileSync(
      file,
      `[Desktop Entry]\nType=Application\nName=Hekaton\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`,
    );
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
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
