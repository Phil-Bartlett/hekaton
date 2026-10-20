// Keeps Hekaton current from its GitHub Releases. Where it can replace
// itself it downloads a newer release in the background and installs it when
// the user restarts, or on the next quit; it never restarts by itself,
// because that would end every live Claude session. Elsewhere it only learns
// that a release exists (see updateState.js).

import { app, net } from "electron";
import electronUpdater from "electron-updater";
import { canCheck, initialState, isNewer, nextState, releaseUrl, updateMode } from "./updateState.js";

const LATEST_RELEASE_API = "https://api.github.com/repos/Phil-Bartlett/hekaton/releases/latest";
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// `onChange(state)` fires on every change; `enabled()` says whether the
// scheduled checks should run (a manual check always does).
export function createUpdater({ onChange, enabled }) {
  const mode = updateMode({
    platform: process.platform,
    appImage: Boolean(process.env.APPIMAGE),
    packaged: app.isPackaged,
  });
  let state = initialState({ mode, current: app.getVersion() });

  function apply(event) {
    const next = nextState(state, event);
    if (next === state) return;
    state = next;
    onChange(state);
  }

  const { autoUpdater } = electronUpdater;
  if (mode === "install") {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = {
      info: () => {},
      debug: () => {},
      warn: (message) => console.warn(`updater: ${message}`),
      error: (message) => console.error(`updater: ${message}`),
    };
    autoUpdater.on("checking-for-update", () => apply({ type: "checking" }));
    autoUpdater.on("update-not-available", () => apply({ type: "current", at: Date.now() }));
    autoUpdater.on("update-available", ({ version }) =>
      apply({ type: "available", version, url: releaseUrl(version), at: Date.now() }),
    );
    autoUpdater.on("download-progress", ({ percent }) => apply({ type: "progress", percent }));
    autoUpdater.on("update-downloaded", ({ version }) => apply({ type: "ready", version }));
    autoUpdater.on("error", (error) => apply({ type: "error", message: error?.message ?? String(error) }));
  }

  // GitHub's "latest release" leaves out drafts and pre-releases.
  async function checkRelease() {
    apply({ type: "checking" });
    const response = await net.fetch(LATEST_RELEASE_API, { headers: { accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = await response.json();
    if (isNewer(release.tag_name, state.current)) {
      apply({ type: "available", version: release.tag_name.replace(/^v/, ""), url: release.html_url, at: Date.now() });
    } else {
      apply({ type: "current", at: Date.now() });
    }
  }

  function check() {
    if (!canCheck(state)) return;
    const run = mode === "install" ? () => autoUpdater.checkForUpdates() : checkRelease;
    Promise.resolve()
      .then(run)
      .catch((error) => apply({ type: "error", message: error.message }));
  }

  function scheduled() {
    if (enabled()) check();
  }

  return {
    state: () => state,
    start() {
      if (mode === "off") return;
      setTimeout(scheduled, FIRST_CHECK_MS);
      setInterval(scheduled, CHECK_EVERY_MS);
    },
    check,
    // Quits through the normal path, so the cards are saved first, then runs
    // the installer silently and starts the new version.
    install() {
      if (state.status === "ready") autoUpdater.quitAndInstall(true, true);
    },
  };
}
