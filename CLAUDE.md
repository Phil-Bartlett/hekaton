# CLAUDE.md — Hekaton

Read alongside `~/.claude/CLAUDE.md`, which carries every cross-project rule. This file adds only what is
Hekaton-specific.

## What it is

A Windows desktop app (Electron + React + xterm.js + node-pty) that launches Claude Code sessions from
saved profiles, hosts each one in its own colour-coded terminal window, and shows state / cost / context
fill for all of them on one dashboard ("the Bridge"). Named for the Hekatoncheires, the hundred-handed
giants. Build plan: `~/.claude/plans/replicated-sprouting-wolf.md`.

## Commands

```
npm start          # build then launch Electron
npm run watch      # esbuild watch (run `npx electron .` separately)
npm run lint       # eslint + prettier --check
npm test           # vitest
npm run rebuild    # electron-rebuild node-pty, only if the prebuilt binary does not load
```

## Layout and conventions

- `src/main/` Electron main (sessions, telemetry receiver, windows, stores, scanners).
  `src/preload/` IPC bridge. `src/renderer/<window>/` one React app per window kind.
  `scripts/build.mjs` is the only build entry; `resources/` holds the `--settings` file handed to Claude.
- Package is `"type": "module"`. Sources are ESM; esbuild emits main and preload as `dist/*.cjs`.
  Renderers are IIFE bundles. Never add a second bundler config.
- Plain JavaScript + JSX, React 18, no TypeScript. Lint and formatting match `argus/frontend`.
- One state store in main; renderers subscribe over IPC and never keep a private copy of session state.
- `~/.claude/` is read-only to this app. Session state arrives through hooks and the statusline relay
  injected per session via `--settings`; nothing is written into Phil's settings or transcripts.
- Claude Code binary: `~/.local/bin/claude.exe` (native install). Launch env carries
  `HEKATON_HOOK_URL` and `HEKATON_STATUS_URL`; the hook command is a no-op without them.

## Status

Phases 1 to 6c verified by Phil on 2026-10-15: embedded terminal, telemetry (hooks + statusline relay +
state machine), the Bridge (profiles rail, profile editor with monitor / size / position / flags,
live session cards, external sessions, monitor map, history + resume, usage panel, reference browser,
settings with WCAG-checked themes, Ctrl+K palette), and session-window chrome (accent scope, pin,
close lock, confirm-close, activity tray, Ctrl+F find). Costs show in pounds with the dollar figure
on hover. `hekaton --launch=<profile>` opens a profile from the command line. Installer (Phase 6d) ships as `npm run dist`. Session persistence: `state.json` keeps every card
(live or SAVED) with its Claude conversation id, window bounds and layout order; Resume reopens the
same card, Dismiss removes it; cards can be moved between profiles and reordered; tiles, compact
tiles or list view. Next: the macOS build on Phil's AIstudio box.

Traps:

- pty output and state updates sent before a session window's renderer is listening are dropped by
  Electron, and Claude's TUI does not redraw on its own. Main buffers output per session and only
  streams live once the renderer calls `pty.attach()`, which returns the buffered scrollback.
- Window chrome is entirely ours. The native `titleBarOverlay` paints an opaque box that cuts the accent
  frame, so Windows / Linux get caption buttons from `shared/CaptionButtons.jsx` via `window:control`.
  Session windows use `roundedCorners: false`; Windows hides about one row at the top of a frameless
  window, so the frame is 3px with a 4px top on win32 (verified even all round by Phil, 2026-10-15).
