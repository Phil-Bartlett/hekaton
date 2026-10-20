import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  busName,
  createKWin,
  focusScript,
  isKde,
  pinScript,
  placeScript,
  qtKeys,
  readReport,
  watcherScript,
} from "../src/main/kwin.js";

// A stand-in for the bits of KWin's scripting API the scripts use.
function fakeKWin(windows) {
  const signal = () => {
    const handlers = [];
    return { connect: (fn) => handlers.push(fn), fire: (...args) => handlers.forEach((fn) => fn(...args)) };
  };
  const calls = [];
  const shortcuts = [];
  const workspace = {
    windowList: () => windows,
    windowAdded: signal(),
    windowRemoved: signal(),
    screensChanged: signal(),
    currentDesktop: 1,
    activeWindow: null,
    screens: [
      {
        name: "DP-1",
        manufacturer: "Dell",
        model: "U2723QE",
        devicePixelRatio: 1.5,
        geometry: { x: 0, y: 0, width: 2560, height: 1440 },
      },
    ],
    clientArea: (_area, screen) => ({ ...screen.geometry, y: 0, height: screen.geometry.height - 44 }),
  };
  const context = vm.createContext({
    workspace,
    KWin: { MaximizeArea: 2 },
    callDBus: (...args) => calls.push(args),
    registerShortcut: (...args) => shortcuts.push(args),
  });
  return { workspace, calls, shortcuts, run: (source) => vm.runInContext(source, context) };
}

function fakeWindow(overrides) {
  return {
    internalId: "{1111}",
    pid: 42,
    caption: "Hekaton",
    frameGeometry: { x: 10.4, y: 20, width: 1180, height: 800 },
    keepAbove: false,
    fullScreen: false,
    minimized: false,
    frameGeometryChanged: { connect() {} },
    ...overrides,
  };
}

describe("isKde", () => {
  it("needs a Wayland session on KDE", () => {
    expect(isKde({ XDG_CURRENT_DESKTOP: "KDE", WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(isKde({ XDG_CURRENT_DESKTOP: "ubuntu:KDE", WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(isKde({ XDG_CURRENT_DESKTOP: "KDE" })).toBe(false);
    expect(isKde({ XDG_CURRENT_DESKTOP: "GNOME", WAYLAND_DISPLAY: "wayland-0" })).toBe(false);
    expect(createKWin({ env: {} })).toBeNull();
  });
});

describe("qtKeys", () => {
  it("spells accelerators as Qt does", () => {
    expect(qtKeys("Control+Alt+H")).toBe("Ctrl+Alt+H");
    expect(qtKeys("Super+Shift+F12")).toBe("Meta+Shift+F12");
    expect(qtKeys("CmdOrCtrl+PageDown")).toBe("Ctrl+PgDown");
    expect(qtKeys("Control+Space")).toBe("Ctrl+Space");
    expect(qtKeys("Control+Hyper+H")).toBeNull();
  });
});

describe("watcherScript", () => {
  const destination = busName(42);

  it("reports this process's windows and the screens' work areas", () => {
    const kwin = fakeKWin([fakeWindow(), fakeWindow({ internalId: "{2222}", pid: 7, caption: "Firefox" })]);
    kwin.run(watcherScript({ destination, pid: 42, keys: null }));
    expect(kwin.calls).toHaveLength(1);
    const [to, objectPath, iface, member, json] = kwin.calls[0];
    expect([to, objectPath, iface, member]).toEqual([
      "io.github.philbartlett.Hekaton.p42",
      "/io/github/philbartlett/Hekaton",
      "io.github.philbartlett.Hekaton",
      "Report",
    ]);
    const { displays, windows } = readReport(json);
    expect([...windows.keys()]).toEqual(["{1111}"]);
    expect(windows.get("{1111}")).toMatchObject({
      title: "Hekaton",
      bounds: { x: 10, y: 20, width: 1180, height: 800 },
      floating: true,
      pinned: false,
    });
    expect(displays).toEqual([
      {
        id: "DP-1",
        label: "Dell U2723QE",
        primary: true,
        bounds: { x: 0, y: 0, width: 2560, height: 1440 },
        workArea: { x: 0, y: 0, width: 2560, height: 1396 },
        scaleFactor: 1.5,
      },
    ]);
  });

  it("reports again when one of its windows appears", () => {
    const kwin = fakeKWin([]);
    kwin.run(watcherScript({ destination, pid: 42, keys: null }));
    kwin.workspace.windowAdded.fire(fakeWindow());
    expect(kwin.calls).toHaveLength(2);
  });

  it("registers the hotkey under a name that carries its keys", () => {
    const kwin = fakeKWin([]);
    kwin.run(watcherScript({ destination, pid: 42, keys: "Ctrl+Alt+H" }));
    expect(kwin.shortcuts).toHaveLength(1);
    const [name, , keys, press] = kwin.shortcuts[0];
    expect([name, keys]).toEqual(["Hekaton: raise the Bridge (Ctrl+Alt+H)", "Ctrl+Alt+H"]);
    press();
    expect(kwin.calls.at(-1).slice(3)).toEqual(["RaiseBridge"]);
  });

  it("registers nothing without a hotkey", () => {
    const kwin = fakeKWin([]);
    kwin.run(watcherScript({ destination, pid: 42, keys: null }));
    expect(kwin.shortcuts).toHaveLength(0);
  });
});

describe("action scripts", () => {
  it("place, pin and focus the window they name", () => {
    const target = fakeWindow();
    const kwin = fakeKWin([fakeWindow({ internalId: "{0000}" }), target]);
    kwin.run(placeScript("{1111}", { x: 8.4, y: 32, width: 600, height: 399.6 }));
    expect(target.frameGeometry).toEqual({ x: 8, y: 32, width: 600, height: 400 });
    kwin.run(pinScript("{1111}", true));
    expect(target.keepAbove).toBe(true);
    kwin.run(focusScript("{1111}"));
    expect(kwin.workspace.activeWindow).toBe(target);
  });

  it("do nothing for a window that has gone", () => {
    const kwin = fakeKWin([]);
    expect(() => kwin.run(placeScript('{9999}"); evil("', { x: 0, y: 0, width: 1, height: 1 }))).not.toThrow();
  });
});
