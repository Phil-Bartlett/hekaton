import { describe, expect, it } from "vitest";
import {
  BINDING_PATH,
  createGnome,
  enableCommands,
  EXTENSION_UUID,
  extensionStatus,
  formatStrv,
  gnomeKeys,
  hotkeyCommands,
  isGnome,
  parseStrv,
  variantString,
} from "../src/main/gnome.js";

const SCHEMA = `org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${BINDING_PATH}`;
const OTHER = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/";

describe("isGnome", () => {
  it("needs a Wayland session on GNOME", () => {
    expect(isGnome({ XDG_CURRENT_DESKTOP: "GNOME", WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(isGnome({ XDG_CURRENT_DESKTOP: "ubuntu:GNOME", WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(isGnome({ XDG_CURRENT_DESKTOP: "GNOME" })).toBe(false);
    expect(isGnome({ XDG_CURRENT_DESKTOP: "KDE", WAYLAND_DISPLAY: "wayland-0" })).toBe(false);
    expect(createGnome({ env: {} })).toBeNull();
  });
});

describe("gnomeKeys", () => {
  it("spells accelerators as GTK does", () => {
    expect(gnomeKeys("Control+Alt+H")).toBe("<Control><Alt>h");
    expect(gnomeKeys("Super+Shift+F12")).toBe("<Super><Shift>F12");
    expect(gnomeKeys("CmdOrCtrl+Space")).toBe("<Control>space");
    expect(gnomeKeys("Control+Hyper+H")).toBeNull();
  });
});

describe("GVariant text", () => {
  it("quotes strings so gsettings reads them back unchanged", () => {
    expect(variantString("it's a \\ path")).toBe("'it\\'s a \\\\ path'");
    expect(parseStrv(formatStrv(["a'b", "c\\d"]))).toEqual(["a'b", "c\\d"]);
  });

  it("reads gsettings' lists, empty ones included", () => {
    expect(parseStrv("@as []\n")).toEqual([]);
    expect(parseStrv(`['${OTHER}']\n`)).toEqual([OTHER]);
  });
});

describe("hotkeyCommands", () => {
  const command = "'/opt/Hekaton/hekaton' '--user-data-dir=/home/me/.config/Hekaton'";

  it("adds Hekaton's shortcut beside the user's own", () => {
    const commands = hotkeyCommands(`['${OTHER}']`, "<Control><Alt>h", command);
    expect(commands).toEqual([
      ["set", SCHEMA, "name", "'Raise the Hekaton Bridge'"],
      ["set", SCHEMA, "command", variantString(command)],
      ["set", SCHEMA, "binding", "'<Control><Alt>h'"],
      ["set", "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings", `['${OTHER}', '${BINDING_PATH}']`],
    ]);
    expect(parseStrv(commands[1][3])).toEqual([command]);
  });

  it("changes the keys in place once the shortcut is listed", () => {
    const commands = hotkeyCommands(`['${BINDING_PATH}']`, "<Super>F12", command);
    expect(commands.map((args) => args[2])).toEqual(["name", "command", "binding"]);
  });

  it("removes only Hekaton's shortcut when the hotkey is cleared", () => {
    expect(hotkeyCommands(`['${OTHER}', '${BINDING_PATH}']`, null, command)).toEqual([
      ["set", "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings", `['${OTHER}']`],
      ["reset", SCHEMA, "name"],
      ["reset", SCHEMA, "command"],
      ["reset", SCHEMA, "binding"],
    ]);
  });
});

describe("enableCommands", () => {
  const OTHER_EXTENSION = "appindicatorsupport@rgcjonas.gmail.com";

  it("adds the extension to the enabled list beside the user's own", () => {
    expect(enableCommands(`['${OTHER_EXTENSION}']`, "@as []")).toEqual([
      ["set", "org.gnome.shell", "enabled-extensions", `['${OTHER_EXTENSION}', '${EXTENSION_UUID}']`],
    ]);
  });

  it("takes it off the disabled list, where it would win", () => {
    expect(enableCommands(`['${EXTENSION_UUID}']`, `['${EXTENSION_UUID}', '${OTHER_EXTENSION}']`)).toEqual([
      ["set", "org.gnome.shell", "disabled-extensions", `['${OTHER_EXTENSION}']`],
    ]);
  });

  it("changes nothing once it is enabled", () => {
    expect(enableCommands(`['${EXTENSION_UUID}']`, "@as []")).toEqual([]);
  });
});

describe("extensionStatus", () => {
  it("is ready once the shell runs the shipped version or newer", () => {
    expect(extensionStatus({ running: 1, shipped: 1, installed: 1 })).toBe("ready");
    expect(extensionStatus({ running: 2, shipped: 1, installed: 2 })).toBe("ready");
  });

  it("is missing when nothing is installed", () => {
    expect(extensionStatus({ running: null, shipped: 1, installed: null })).toBe("missing");
  });

  it("waits for a login once installed but not running", () => {
    expect(extensionStatus({ running: null, shipped: 1, installed: 1 })).toBe("login");
    expect(extensionStatus({ running: 1, shipped: 2, installed: 2 })).toBe("login");
  });

  it("is outdated when an older copy is both installed and running", () => {
    expect(extensionStatus({ running: 1, shipped: 2, installed: 1 })).toBe("outdated");
  });
});
