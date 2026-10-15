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

## Running it

```
npm install
npm start
```

Windows 11 first; the platform-specific bits (binary path, window chrome, ConPTY option) live in
`src/main/platform.js`.

## Packages

- Windows: `npm run dist` builds `out/Hekaton-Setup-<version>.exe` (per-user NSIS installer).
- Linux: `npm run dist:linux` builds `out/Hekaton-<version>-x64.AppImage` and `.deb` (node-pty is
  rebuilt for Electron first, as it ships no Linux prebuild). Install the deb with
  `sudo apt install ./Hekaton-<version>-amd64.deb`, or `chmod +x` the AppImage and run it. On Ubuntu
  24.04 an AppImage may need `--no-sandbox` because of the AppArmor user-namespace restriction.
- macOS: `npm run dist:mac` builds a dmg; unsigned, so first launch is right-click, Open.
- CI builds the Windows installer and the Linux packages on every push to main and keeps them as
  workflow artifacts.

Claude Code must be installed on the machine (`~/.local/bin/claude`, or on the PATH, or set under
Settings, Paths); Hekaton launches it and never bundles it.

## Layout

- `src/main/` Electron main: sessions, telemetry receiver, windows, stores, scanners.
- `src/preload/` the IPC bridge exposed as `window.hekaton`.
- `src/renderer/bridge/` the dashboard, `src/renderer/session/` the session window.
- `scripts/build.mjs` esbuild for all three tiers; `scripts/statusline-relay.sh` chains the user's own
  statusline after forwarding its JSON to the app.
- `test/` vitest for the pure modules (state machine, transcript parser, pricing, launch args, registry).
