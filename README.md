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

Windows 11 first; the platform-specific bits (binary path, title bar, ConPTY option) live in
`src/main/platform.js` so a macOS build is a packaging and test job.

## Layout

- `src/main/` Electron main: sessions, telemetry receiver, windows, stores, scanners.
- `src/preload/` the IPC bridge exposed as `window.hekaton`.
- `src/renderer/bridge/` the dashboard, `src/renderer/session/` the session window.
- `scripts/build.mjs` esbuild for all three tiers; `scripts/statusline-relay.sh` chains the user's own
  statusline after forwarding its JSON to the app.
- `test/` vitest for the pure modules (state machine, transcript parser, pricing, launch args, registry).
