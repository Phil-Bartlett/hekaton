# Hekaton

A window manager and live dashboard for running many Claude Code sessions at once.
Named for the Hekatoncheires, the hundred-handed giants.

Hekaton launches Claude Code from saved profiles, hosts each session in its own colour-coded terminal
window, and shows every session's state, running cost and context fill on one dashboard (the Bridge).
Sessions started outside Hekaton appear too, read from Claude Code's own session registry.

## What works today

- Launch profiles: name, working directory, model, effort, permission mode, accent colour and where the
  colour applies. `hekaton --launch=<profile>` starts one from the command line.
- Session windows: embedded terminal (xterm.js over a ConPTY), state pill, cost and context in the title
  bar, pin always-on-top, close lock, confirm-before-close, and an activity tray showing each prompt's
  tool calls, durations, tokens and estimated cost.
- The Bridge: profiles rail, live session cards (focus / centre / bring here / terminate), external
  sessions.
- Telemetry comes from Claude Code itself: lifecycle hooks and the statusline, injected per session with
  `--settings`, so nothing in `~/.claude` is modified.
- Saved cards: a session that ends, or the app closing, leaves a card that resumes the same conversation
  in the same place. Cards can be moved between profiles and reordered. A conversation Claude ran on its
  own can be adopted onto a profile; a card whose conversation is still running outside Hekaton says so
  and offers to end that copy instead of starting a second one.
- Attention: an OS notification and a taskbar flash when an unfocused session stops for an approval or
  finishes a turn. A tray icon keeps the app running with every window closed; it can start at sign-in.
- Remote Control: a profile flag launches with `--remote-control`, so the Claude app on a phone can
  drive the session; the card shows a Remote badge while it is connected.
- Shared data folder: profiles, settings, cards and history can live in a OneDrive or Syncthing folder
  and follow you between machines. A card made on another machine names it and resumes only there,
  because the transcript stays on that machine.
- Terminal: Shift+Enter for a newline, Ctrl+F find, links open in the browser, extra `--add-dir`
  folders per profile.
- Artifacts and links: published claude.ai artifacts and pull requests a session produces show as
  clickable chips in its activity tray and on its Bridge card.
- Worktrees: a profile can launch in its own git worktree and branch, so parallel sessions edit
  separate checkouts.
- Naming: cards take Claude's own session name, falling back to its generated title, so each reads as
  its subject rather than just the profile name.
- Organising: cards sort by manual order, profile, project (grouped under a per-repository header) or
  recency, as tiles, compact tiles or a list.
- Cost: the activity tray shows a whole-session estimate from the price table beside Claude's own
  reported figure, each labelled for what it is.
- Arranging: Tile lays the live session windows out as a grid, columns, rows or a main window beside a
  stack, on any display; Undo puts them back. Named layouts save where every window sits and reapply
  it later.

## Omarchy and Hyprland

Under Hyprland (Omarchy's compositor) Hekaton cannot place its own windows: Wayland gives a window no
say in where it goes, and Electron reports the size it asked for rather than the real one. When
`HYPRLAND_INSTANCE_SIGNATURE` is set, Hekaton reads and moves its windows through Hyprland's control
socket instead (`src/main/hyprland.js`):

- New windows open wherever Hyprland tiles them. Tile, Centre, Bring Here and named layouts float the
  windows they move; Undo, and a layout saved while windows were tiled, hand them back to the tiler.
- Pin uses Hyprland's own pin, and the profile colour becomes the window's Hyprland border.
- Hyprland draws the frame and owns moving, resizing and closing, so there are no caption buttons and
  windows have no minimum size; the Bridge and the session title bars fit narrow tiles.
- Minimise is not offered: Hyprland has none.

Omarchy ships FUSE 3 only, and an AppImage needs `libfuse.so.2`: install it with `sudo pacman -S fuse2`,
or run the AppImage with `APPIMAGE_EXTRACT_AND_RUN=1` set.

Other Wayland compositors (Sway, GNOME, KDE) have the same placement limit and no adapter yet; there
the windows open and work but the placement commands do nothing.

## Running it

```
npm install
npm start
```

Windows 11 first; the platform-specific bits (binary path, window chrome, ConPTY option) live in
`src/main/platform.js`.

## Packages

All build artifacts land in `out/` (gitignored), named by version.

- Windows: `npm run dist` builds `out/Hekaton-Setup-<version>.exe` (per-user NSIS installer).
- Linux: `npm run dist:linux` builds `out/Hekaton-<version>-x86_64.AppImage` and
  `out/Hekaton-<version>-amd64.deb` (node-pty is rebuilt for Electron first, as it ships no Linux
  prebuild). Install the deb with `sudo apt install ./Hekaton-<version>-amd64.deb`, or `chmod +x` the
  AppImage and run it. On Ubuntu 24.04 an AppImage may need `--no-sandbox` because of the AppArmor
  user-namespace restriction.
- macOS: `npm run dist:mac` builds a dmg; unsigned, so first launch is right-click, Open.
- CI builds the Windows installer and the Linux packages on every push to main and keeps them as
  workflow artifacts. Pushing a `v*` tag (`git tag v0.2.0 && git push origin v0.2.0`) builds them again
  and publishes a GitHub Release with the packages attached. Builds are unsigned.

Claude Code must be installed on the machine (`~/.local/bin/claude`, or on the PATH, or set under
Settings, Paths); Hekaton launches it and never bundles it.

## Layout

- `src/main/` Electron main: sessions, telemetry receiver, windows, stores, scanners.
- `src/preload/` the IPC bridge exposed as `window.hekaton`.
- `src/renderer/bridge/` the dashboard, `src/renderer/session/` the session window.
- `scripts/build.mjs` esbuild for all three tiers; `scripts/statusline-relay.sh` chains the user's own
  statusline after forwarding its JSON to the app.
- `test/` vitest for the pure modules (state machine, transcript parser, pricing, launch args, registry).
