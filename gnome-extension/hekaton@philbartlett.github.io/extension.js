// GNOME gives an app no way to place its own windows on Wayland, and no
// longer lets one run code in the shell, so Hekaton asks this extension
// instead (src/main/gnome.js). A Hekaton process calls Watch; from then on
// the extension reports that process's windows and the monitors' work areas
// back to it whenever they change, in the shape KWin's scripts use
// (src/main/kwin.js), and places, pins and focuses those windows on request.
// A caller only ever sees and moves the windows of its own process.

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const BUS_NAME = "io.github.philbartlett.HekatonShell";
const OBJECT_PATH = "/io/github/philbartlett/HekatonShell";
const CLIENT_PATH = "/io/github/philbartlett/Hekaton";
const CLIENT_INTERFACE = "io.github.philbartlett.Hekaton";

// Moves and resizes signal on every frame of a drag, so reports are batched.
const REPORT_DELAY_MS = 50;

const INTERFACE_XML = `<node>
  <interface name="io.github.philbartlett.HekatonShell">
    <property name="Version" type="u" access="read"/>
    <method name="Watch"/>
    <method name="Place">
      <arg name="id" type="s" direction="in"/>
      <arg name="x" type="i" direction="in"/>
      <arg name="y" type="i" direction="in"/>
      <arg name="width" type="i" direction="in"/>
      <arg name="height" type="i" direction="in"/>
    </method>
    <method name="Pin">
      <arg name="id" type="s" direction="in"/>
      <arg name="above" type="b" direction="in"/>
    </method>
    <method name="Focus">
      <arg name="id" type="s" direction="in"/>
    </method>
  </interface>
</node>`;

const WINDOW_SIGNALS = [
  "position-changed",
  "size-changed",
  "notify::title",
  "notify::above",
  "notify::fullscreen",
  "notify::minimized",
];

function rect({ x, y, width, height }) {
  return { x, y, width, height };
}

// GNOME 49 replaced get_maximized and dropped unmaximize's flags.
function isMaximized(window) {
  return typeof window.is_maximized === "function" ? window.is_maximized() : window.get_maximized() !== 0;
}

function unmaximize(window) {
  if (typeof window.is_maximized === "function") window.unmaximize();
  else window.unmaximize(Meta.MaximizeFlags.BOTH);
}

// A monitor's connector and name, which Meta only exposes from GNOME 49.
function monitorNames(index) {
  const logical = global.backend
    .get_monitor_manager?.()
    ?.get_logical_monitors?.()
    ?.find((candidate) => candidate.get_number() === index);
  const monitor = logical?.get_monitors()[0];
  return { connector: monitor?.get_connector?.() ?? null, label: monitor?.get_display_name?.() ?? null };
}

function screens() {
  const display = global.display;
  const workspace = global.workspace_manager.get_active_workspace();
  const primary = display.get_primary_monitor();
  const list = [];
  for (let index = 0; index < display.get_n_monitors(); index += 1) {
    const { connector, label } = monitorNames(index);
    const screen = {
      name: connector ?? `monitor-${index}`,
      manufacturer: "",
      model: label ?? `Display ${index + 1}`,
      scale: display.get_monitor_scale(index),
      bounds: rect(display.get_monitor_geometry(index)),
      workArea: rect(workspace.get_work_area_for_monitor(index)),
    };
    // The window manager takes the first screen as the primary one.
    if (index === primary) list.unshift(screen);
    else list.push(screen);
  }
  return list;
}

function windowsOf(pid) {
  return global.display
    .list_all_windows()
    .filter((window) => window.get_pid() === pid && window.get_window_type() === Meta.WindowType.NORMAL);
}

function snapshot(pid) {
  const windows = windowsOf(pid).map((window) => ({
    id: String(window.get_id()),
    title: window.get_title() ?? "",
    bounds: rect(window.get_frame_rect()),
    pinned: window.is_above(),
    fullscreen: window.is_fullscreen(),
    minimized: window.minimized,
  }));
  return JSON.stringify({ windows, screens: screens() });
}

export default class HekatonExtension extends Extension {
  enable() {
    // Each watching process by its unique bus name: its pid, the last report
    // it was sent, and the watch on its name that drops it when it exits.
    this._clients = new Map();
    this._windowHandlers = new Map();
    this._reportSource = 0;

    this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, this._service());
    this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    this._nameId = Gio.bus_own_name_on_connection(Gio.DBus.session, BUS_NAME, Gio.BusNameOwnerFlags.NONE, null, null);

    for (const window of global.display.list_all_windows()) this._track(window);
    global.display.connectObject(
      "window-created",
      (_display, window) => {
        this._track(window);
        this._scheduleReport();
      },
      "workareas-changed",
      () => this._scheduleReport(),
      this,
    );
    global.workspace_manager.connectObject("active-workspace-changed", () => this._scheduleReport(), this);
    Main.layoutManager.connectObject("monitors-changed", () => this._scheduleReport(), this);
  }

  // GNOME 51 requires disable to be synchronous.
  disable() {
    global.display.disconnectObject(this);
    global.workspace_manager.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);
    for (const [window, ids] of this._windowHandlers) for (const id of ids) window.disconnect(id);
    for (const client of this._clients.values()) Gio.bus_unwatch_name(client.watchId);
    if (this._reportSource) GLib.source_remove(this._reportSource);
    Gio.bus_unown_name(this._nameId);
    this._dbus.unexport();
    this._dbus = null;
    this._clients = null;
    this._windowHandlers = null;
    this._reportSource = 0;
  }

  // Version is metadata.json's hekaton-version, which Hekaton compares with
  // the copy it ships to tell when the running extension is out of date.
  _service() {
    const version = this.metadata["hekaton-version"];
    return {
      get Version() {
        return version;
      },
      WatchAsync: (_params, invocation) => this._watch(invocation),
      PlaceAsync: ([id, x, y, width, height], invocation) =>
        this._act(invocation, id, (window) => {
          if (isMaximized(window)) unmaximize(window);
          window.move_resize_frame(false, x, y, width, height);
        }),
      PinAsync: ([id, above], invocation) =>
        this._act(invocation, id, (window) => (above ? window.make_above() : window.unmake_above())),
      FocusAsync: ([id], invocation) =>
        this._act(invocation, id, (window) => Main.activateWindow(window, global.get_current_time())),
    };
  }

  // The caller's pid comes from the bus, not from the caller, so a process
  // can only ever watch and move its own windows.
  _watch(invocation) {
    const sender = invocation.get_sender();
    Gio.DBus.session.call(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "GetConnectionUnixProcessID",
      new GLib.Variant("(s)", [sender]),
      new GLib.VariantType("(u)"),
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (connection, result) => {
        try {
          const [pid] = connection.call_finish(result).deepUnpack();
          if (!this._clients) throw new Error("Hekaton's extension was disabled");
          if (!this._clients.has(sender)) {
            const watchId = Gio.bus_watch_name_on_connection(
              connection,
              sender,
              Gio.BusNameWatcherFlags.NONE,
              null,
              () => this._forget(sender),
            );
            this._clients.set(sender, { pid, last: null, watchId });
          }
          this._clients.get(sender).last = null;
          invocation.return_value(null);
          this._report(sender);
        } catch (error) {
          invocation.return_gerror(error);
        }
      },
    );
  }

  _forget(sender) {
    const client = this._clients?.get(sender);
    if (!client) return;
    Gio.bus_unwatch_name(client.watchId);
    this._clients.delete(sender);
  }

  _act(invocation, id, action) {
    const client = this._clients.get(invocation.get_sender());
    if (!client) {
      invocation.return_dbus_error(`${BUS_NAME}.Error.NotWatching`, "Call Watch first");
      return;
    }
    const window = windowsOf(client.pid).find((candidate) => String(candidate.get_id()) === id);
    if (window) action(window);
    invocation.return_value(null);
  }

  _track(window) {
    if (this._windowHandlers.has(window)) return;
    const ids = WINDOW_SIGNALS.map((name) => window.connect(name, () => this._scheduleReport()));
    ids.push(
      window.connect("unmanaged", () => {
        for (const id of this._windowHandlers.get(window) ?? []) window.disconnect(id);
        this._windowHandlers.delete(window);
        this._scheduleReport();
      }),
    );
    this._windowHandlers.set(window, ids);
  }

  _scheduleReport() {
    if (this._reportSource || this._clients.size === 0) return;
    this._reportSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REPORT_DELAY_MS, () => {
      this._reportSource = 0;
      for (const sender of this._clients.keys()) this._report(sender);
      return GLib.SOURCE_REMOVE;
    });
  }

  // Sends a client its report, unless nothing in it has changed.
  _report(sender) {
    const client = this._clients.get(sender);
    const json = snapshot(client.pid);
    if (json === client.last) return;
    client.last = json;
    Gio.DBus.session.call(
      sender,
      CLIENT_PATH,
      CLIENT_INTERFACE,
      "Report",
      new GLib.Variant("(s)", [json]),
      null,
      Gio.DBusCallFlags.NO_AUTO_START,
      -1,
      null,
      (connection, result) => {
        try {
          connection.call_finish(result);
        } catch (error) {
          console.error(`Hekaton: report to ${sender} failed: ${error.message}`);
        }
      },
    );
  }
}
