import { describe, expect, it } from "vitest";
import {
  batch,
  borderCommands,
  createHyprland,
  displayMatching,
  displaysFrom,
  pinCommands,
  placeCommands,
  socketPath,
  windowsFrom,
} from "../src/main/hyprland.js";

const monitor = {
  id: 0,
  name: "Virtual-1",
  description: "Red Hat Inc. QEMU Monitor",
  width: 1280,
  height: 800,
  x: 0,
  y: 0,
  scale: 1,
  transform: 0,
  reserved: [0, 26, 0, 0],
  disabled: false,
};

describe("socketPath", () => {
  it("is under the runtime dir for the running instance", () => {
    expect(
      socketPath({ HYPRLAND_INSTANCE_SIGNATURE: "abc", XDG_RUNTIME_DIR: "/run/user/1000" }).replace(/\\/g, "/"),
    ).toBe("/run/user/1000/hypr/abc/.socket.sock");
  });

  it("is null outside Hyprland", () => {
    expect(socketPath({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBeNull();
    expect(createHyprland({ env: {} })).toBeNull();
  });
});

describe("displaysFrom", () => {
  it("takes the bar's reserved space out of the work area", () => {
    expect(displaysFrom([monitor])).toEqual([
      {
        id: 0,
        label: "Red Hat Inc. QEMU Monitor",
        primary: true,
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        workArea: { x: 0, y: 26, width: 1280, height: 774 },
        scaleFactor: 1,
      },
    ]);
  });

  it("works in logical pixels for a scaled or rotated monitor", () => {
    const [scaled, rotated] = displaysFrom([
      { ...monitor, width: 3840, height: 2160, scale: 2, reserved: [0, 0, 0, 0] },
      { ...monitor, id: 1, x: 1920, width: 2560, height: 1440, transform: 1, reserved: [10, 0, 20, 0] },
    ]);
    expect(scaled.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(rotated.bounds).toEqual({ x: 1920, y: 0, width: 1440, height: 2560 });
    expect(rotated.workArea).toEqual({ x: 1930, y: 0, width: 1410, height: 2560 });
    expect(rotated.primary).toBe(false);
  });

  it("leaves out disabled monitors", () => {
    expect(displaysFrom([monitor, { ...monitor, id: 1, disabled: true }])).toHaveLength(1);
  });
});

describe("windowsFrom", () => {
  const client = (overrides) => ({
    address: "0x1",
    pid: 42,
    mapped: true,
    initialTitle: "Hekaton",
    at: [12, 38],
    size: [621, 750],
    floating: false,
    pinned: false,
    fullscreen: 0,
    ...overrides,
  });

  it("keys this process's windows by the title they opened with", () => {
    const windows = windowsFrom(
      [
        client(),
        client({ address: "0x2", initialTitle: "Hekaton session a", floating: true, fullscreen: 2 }),
        client({ pid: 7 }),
      ],
      42,
    );
    expect([...windows.keys()]).toEqual(["Hekaton", "Hekaton session a"]);
    expect(windows.get("Hekaton")).toEqual({
      address: "0x1",
      bounds: { x: 12, y: 38, width: 621, height: 750 },
      floating: false,
      pinned: false,
      fullscreen: false,
    });
    expect(windows.get("Hekaton session a").fullscreen).toBe(true);
  });
});

describe("displayMatching", () => {
  const displays = displaysFrom([monitor, { ...monitor, id: 1, x: 1280 }]);

  it("picks the display the rectangle covers most", () => {
    expect(displayMatching(displays, { x: 1200, y: 0, width: 400, height: 300 }).id).toBe(1);
  });

  it("falls back to the primary display off screen", () => {
    expect(displayMatching(displays, { x: -5000, y: 0, width: 100, height: 100 }).id).toBe(0);
  });
});

describe("commands", () => {
  it("floats, then resizes, then moves", () => {
    expect(placeCommands("0x5597db5b52a0", { x: 8.4, y: 34, width: 600, height: 380.6 })).toEqual([
      'hl.dsp.window.float({ action = "enable", window = "address:0x5597db5b52a0" })',
      'hl.dsp.window.resize({ x = 600, y = 381, window = "address:0x5597db5b52a0" })',
      'hl.dsp.window.move({ x = 8, y = 34, window = "address:0x5597db5b52a0" })',
    ]);
  });

  it("floats a window before pinning it", () => {
    expect(pinCommands("0xab", true)).toHaveLength(2);
    expect(pinCommands("0xab", false)).toEqual(['hl.dsp.window.pin({ action = "disable", window = "address:0xab" })']);
  });

  it("only sets a border from a hex colour", () => {
    expect(borderCommands("0xab", "#E5A50A")).toEqual([
      'hl.dsp.window.set_prop({ window = "address:0xab", prop = "active_border_color", value = "rgb(E5A50A)" })',
    ]);
    expect(borderCommands("0xab", "red")).toEqual([]);
    expect(borderCommands("0xab", null)).toEqual([]);
  });

  it("refuses anything that is not a window address", () => {
    expect(() => placeCommands('0x1" }) os.exit() --', { x: 0, y: 0, width: 1, height: 1 })).toThrow();
  });

  it("batches dispatchers", () => {
    expect(batch(["a()", "b()"])).toBe("[[BATCH]]dispatch a();dispatch b()");
  });
});
