import { Menu, Tray, nativeImage } from "electron";

// The tray keeps Hekaton alive with every window closed and is the way back
// to the Bridge on desktops without global shortcuts (Wayland).
export function createTray({ iconPath, onShowBridge, onQuit }) {
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  const tray = new Tray(icon);
  tray.setToolTip("Hekaton");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Bridge", click: onShowBridge },
      { type: "separator" },
      { label: "Quit Hekaton", click: onQuit },
    ]),
  );
  tray.on("click", onShowBridge);
  tray.on("double-click", onShowBridge);
  return tray;
}
