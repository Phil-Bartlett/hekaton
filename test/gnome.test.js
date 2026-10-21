import { describe, expect, it } from "vitest";
import {
  BINDING_PATH,
  createGnome,
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
