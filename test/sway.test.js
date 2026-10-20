import { describe, expect, it } from "vitest";
import {
  createSway,
  decode,
  displaysFrom,
  encode,
  pinCommand,
  placeCommand,
  swayKeys,
  tileCommand,
  windowsFrom,
} from "../src/main/sway.js";

describe("ipc framing", () => {
  it("round-trips a message", () => {
    const message = encode(4, '{"ok":true}');
    expect(message.subarray(0, 6).toString()).toBe("i3-ipc");
    expect(message.readUInt32LE(6)).toBe(11);
    expect(message.readUInt32LE(10)).toBe(4);
    expect(decode(message)).toEqual({ ok: true });
  });

  it("waits for the whole reply", () => {
    expect(decode(encode(0, "[1,2,3]").subarray(0, 16))).toBeNull();
  });

  it("is null outside Sway", () => {
    expect(createSway({ env: {} })).toBeNull();
  });
});

describe("displaysFrom", () => {
  const output = {
    name: "HEADLESS-1",
    make: "Unknown",
    model: "Unknown",
    active: true,
    rect: { x: 0, y: 0, width: 1280, height: 800 },
    scale: 1,
  };

  it("uses the visible workspace, less the bar, as the work area", () => {
    const workspaces = [
      { output: "HEADLESS-1", visible: false, rect: { x: 0, y: 0, width: 1, height: 1 } },
      { output: "HEADLESS-1", visible: true, rect: { x: 0, y: 24, width: 1280, height: 776 } },
    ];
    expect(displaysFrom([output], workspaces)).toEqual([
      {
        id: "HEADLESS-1",
        label: "HEADLESS-1",
        primary: true,
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        workArea: { x: 0, y: 24, width: 1280, height: 776 },
        scaleFactor: 1,
      },
    ]);
  });

  it("names a real monitor and leaves out inactive ones", () => {
    const displays = displaysFrom(
      [
        { ...output, name: "DP-1", make: "Dell", model: "U2723QE" },
        { ...output, name: "DP-2", active: false },
      ],
      [],
    );
    expect(displays).toHaveLength(1);
    expect(displays[0].label).toBe("Dell U2723QE");
    expect(displays[0].workArea).toEqual(output.rect);
  });
});

describe("windowsFrom", () => {
  it("finds this process's windows, tiled and floating", () => {
    const tree = {
      nodes: [
        {
          nodes: [
            { id: 5, pid: 42, name: "Hekaton", rect: { x: 0, y: 24, width: 640, height: 776 }, fullscreen_mode: 0 },
            { id: 6, pid: 7, name: "Firefox", rect: { x: 640, y: 24, width: 640, height: 776 } },
          ],
          floating_nodes: [
            {
              id: 9,
              pid: 42,
              name: "Hekaton session a",
              rect: { x: 100, y: 150, width: 600, height: 400 },
              sticky: true,
              fullscreen_mode: 1,
            },
          ],
        },
      ],
    };
    const windows = windowsFrom(tree, 42);
    expect([...windows.keys()]).toEqual([5, 9]);
    expect(windows.get(5)).toEqual({
      id: 5,
      title: "Hekaton",
      bounds: { x: 0, y: 24, width: 640, height: 776 },
      floating: false,
      pinned: false,
      fullscreen: false,
    });
    expect(windows.get(9)).toMatchObject({ floating: true, pinned: true, fullscreen: true });
  });
});

describe("commands", () => {
  it("floats, resizes, then moves", () => {
    expect(placeCommand(5, { x: 8.4, y: 32, width: 600, height: 399.6 })).toBe(
      "[con_id=5] floating enable, resize set width 600 px height 400 px, move absolute position 8 px 32 px",
    );
  });

  it("tiles and pins", () => {
    expect(tileCommand(5)).toBe("[con_id=5] floating disable");
    expect(pinCommand(5, true)).toBe("[con_id=5] floating enable, sticky enable");
    expect(pinCommand(5, false)).toBe("[con_id=5] sticky disable");
  });

  it("refuses anything that is not a container id", () => {
    expect(() => tileCommand("5] kill; [title=.*")).toThrow();
  });
});

describe("swayKeys", () => {
  it("spells accelerators as bindsym does", () => {
    expect(swayKeys("Control+Alt+H")).toBe("Ctrl+Mod1+h");
    expect(swayKeys("Super+Shift+F12")).toBe("Mod4+Shift+F12");
    expect(swayKeys("CmdOrCtrl+Space")).toBe("Ctrl+space");
  });

  it("refuses what it cannot express", () => {
    expect(swayKeys("Control+Hyper+H")).toBeNull();
  });
});
