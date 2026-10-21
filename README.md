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
  and follow you between machines. Every machine on the folder sees the others' live sessions and
  saved cards, can end a session or resume a card on the machine that holds it, and can read the
  others' Claude memory notes; see "Several machines" below.
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

## Several machines

Point every machine's data folder (Settings, Paths) at one folder a sync tool carries between them, and
each Bridge shows the whole fleet:

- Each machine writes only under `hosts/<its id>/` in that folder: its saved cards (`state.json`) and a
  presence file (`host.json`) with a heartbeat and its live sessions. Nothing is ever written to the
  same file from two machines, so the sync tool has nothing to merge. The id is minted on first run and
  kept in the local user-data folder, so a renamed machine keeps its cards.
- The other machines' live sessions appear as cards with the machine's name on them, read-only apart
  from Terminate; their saved cards offer "Resume on <machine>". A machine whose heartbeat is more than
  a minute old shows as offline. A filter picks one machine or all.
- A request to another machine is a new file in its `inbox/`; that machine carries it out, answers
  under its own `results/` and deletes the request. A request older than five minutes (the machine was
  away) is dropped, not acted on late. The card shows the wait and any refusal.
- With "Share Claude's memory notes" on, a machine copies `~/.claude/CLAUDE.md` and each project's
  memory notes into its host folder every few minutes, and every machine lists all of them under
  Memory in the reference browser. One way only: nothing is written back into `~/.claude`, and turning
  the setting off removes the copies. It is off until you turn it on.

OneDrive and SharePoint are fine for the saved cards and the memory notes; for live presence they can
lag by a minute or more, so a Syncthing or SMB folder gives a truer picture. For machines that are not on
one network, or for live presence without waiting on a sync tool, run the hub in `server/` and pair each
machine with it under Settings, Paths: presence and requests then go over a socket, with the folder as
the fallback. See `server/README.md`.

## Omarchy, Hyprland, Sway, KDE Plasma and GNOME

Under a Wayland compositor Hekaton cannot place its own windows: Wayland gives a window no say in where
it goes, and Electron reports the size it asked for rather than the real one. Under Hyprland (Omarchy's
compositor, found by `HYPRLAND_INSTANCE_SIGNATURE`) or Sway (`SWAYSOCK`), Hekaton reads and moves its
windows through the compositor's control socket instead (`src/main/hyprland.js`, `src/main/sway.js`):

- New windows open wherever the compositor tiles them. Tile, Centre, Bring Here and named layouts float
  the windows they move; Undo, and a layout saved while windows were tiled, hand them back to the tiler.
- Pin uses Hyprland's pin or Sway's sticky. Under Hyprland the profile colour becomes the window's
  border; Sway cannot colour one window's border, so there the accent frame stays.
- The compositor owns moving, resizing and closing, so there are no caption buttons and windows have
  no minimum size; the Bridge and the session title bars fit narrow tiles.
- The global hotkey is bound in the compositor, because Electron's shortcuts never fire on Wayland. It
  relaunches Hekaton, which raises the running Bridge, so the same keys also start Hekaton. The binding
  lasts until the compositor restarts.
- Minimise is not offered: neither compositor has one.

Omarchy ships FUSE 3 only, and an AppImage needs `libfuse.so.2`: install it with `sudo pacman -S fuse2`,
or run the AppImage with `APPIMAGE_EXTRACT_AND_RUN=1` set.

Under KDE Plasma on Wayland (`XDG_CURRENT_DESKTOP` includes `KDE`), Hekaton drives KWin with KWin
scripts loaded over D-Bus (`src/main/kwin.js`): a long-lived script reports Hekaton's windows and each
screen's work area whenever they change, and short ones place, pin and focus a window. KWin floats
windows, honours minimum sizes and draws no frame for Hekaton's frameless windows, so there Hekaton keeps
its caption buttons, minimum sizes and accent frame; Pin is KWin's keep-above. The hotkey is a KDE
global shortcut, listed in System Settings as "Hekaton: raise the Bridge (keys)", that raises the Bridge
while Hekaton is running.

Under GNOME on Wayland (`XDG_CURRENT_DESKTOP` includes `GNOME`), GNOME lets no app run code in the
shell, so Hekaton ships a GNOME Shell extension of its own (`gnome-extension/`, GNOME 45 to 51) and
talks to it over D-Bus (`src/main/gnome.js`). The extension reports Hekaton's windows and each
monitor's work area whenever they change, and places, pins and focuses a window on request; it only
ever sees and moves the windows of the process that asked. As under KWin, Hekaton keeps its caption
buttons, minimum sizes and accent frame, and Pin is always-on-top.

- The first time Hekaton runs under GNOME, the Bridge title bar offers "Install GNOME extension". It
  copies the extension to `~/.local/share/gnome-shell/extensions/` and enables it. GNOME on Wayland only
  loads an extension at login, so log out and back in once; until then the windows open and work, but
  the placement commands do nothing. A newer Hekaton that ships a newer extension offers "Update GNOME
  extension" the same way.
- The hotkey is a GNOME custom shortcut, listed in Settings, Keyboard, Custom Shortcuts as "Raise the
  Hekaton Bridge". It relaunches Hekaton, which raises the running Bridge, so the same keys also start
  Hekaton.
- GNOME shortcuts never reach an input method that grabs every key. Omarchy's fcitx5 does this under
  GNOME while a text field, Hekaton's terminal included, has focus, and Ctrl+Alt+H is also fcitx5's
  own completion toggle. A stock GNOME install uses IBus and is not affected; on Omarchy, switch to
  IBus for GNOME sessions.

## Running it

```
npm install
npm start
```

Windows 11 first; the platform-specific bits (binary path, window chrome, ConPTY option) live in
`src/main/platform.js`.

### Checking a CSS change

Two rules of equal specificity swap winners silently when rules or files are reordered. The style
check records the computed style of every element the Bridge draws, in each of its views at 1180,
800 and 640 px, against a fixed fixture (nothing from the machine's own Claude sessions), so a change
can be shown to touch only what it meant to:

```
npm run style:record -- before.json     # on the code before the change
npm run style:record -- after.json      # on the code after it
npm run style:compare -- before.json after.json
```

`compare` lists each element whose style changed, by view, and exits non-zero if any did. The
fixture includes the machine's displays (the monitor map, the profile editor's display list), so
compare recordings made with the same monitors connected.

Every pull request runs the same check in CI (`.github/workflows/style.yml`): it records the base and
the pull request on one runner and fails if any element's style differs. When a change is meant to
move something, add the `style-change` label; the report stays in the job summary and the check
passes.

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

## Code signing policy

Releases are unsigned today. Windows releases are moving to free code signing provided by
[SignPath.io](https://about.signpath.io), with a certificate from the
[SignPath Foundation](https://signpath.org); until then Windows SmartScreen and Defender may hold the
installer back while they check it.

Every release is built from this repository by the [Release workflow](.github/workflows/release.yml)
on GitHub-hosted runners, from a `v*` tag; nothing is built or signed on a personal machine.

- Committers and reviewers: [Phil-Bartlett](https://github.com/Phil-Bartlett),
  [Comm4nd0](https://github.com/Comm4nd0). Changes from anyone else arrive as pull requests and are
  reviewed by one of them before they merge.
- Approvers: [Phil-Bartlett](https://github.com/Phil-Bartlett) approves each release for signing.

## Privacy

Hekaton collects no telemetry and sends nothing about you, your sessions or your files anywhere. It
makes two kinds of request of its own, neither carrying any personal data:

- GitHub's releases API, to check for a newer version. Turn this off under Settings, General, Updates.
- [open.er-api.com](https://www.exchangerate-api.com), a few times a day, for the dollar-to-pound rate
  used in cost figures.

Hekaton's own telemetry receiver listens on 127.0.0.1 only and hears from the Claude Code sessions it
launched. Claude Code itself talks to Anthropic under
[Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).

## Layout

- `src/main/` Electron main: sessions, telemetry receiver, windows, stores, scanners.
- `src/preload/` the IPC bridge exposed as `window.hekaton`.
- `src/renderer/bridge/` the dashboard, `src/renderer/session/` the session window.
- `scripts/build.mjs` esbuild for all three tiers; `scripts/statusline-relay.sh` chains the user's own
  statusline after forwarding its JSON to the app.
- `test/` vitest for the pure modules (state machine, transcript parser, pricing, launch args, registry).
