// What the Bridge shows about updates, and how each updater event changes
// it. Pure, so the rules are tested without Electron.

export const RELEASES_PAGE = "https://github.com/Phil-Bartlett/hekaton/releases";

// "install": Windows and an AppImage download a release and replace
// themselves. "link": a deb needs a root password and an unsigned Mac app
// cannot replace itself, so those only point at the release page. "off": a
// development run has nothing to update.
export function updateMode({ platform, appImage, packaged }) {
  if (!packaged) return "off";
  if (platform === "win32" || (platform === "linux" && appImage)) return "install";
  return "link";
}

function parts(version) {
  return String(version)
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

// Hekaton's release versions are plain x.y.z.
export function isNewer(candidate, current) {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export function releaseUrl(version) {
  return `${RELEASES_PAGE}/tag/v${version}`;
}

export function initialState({ mode, current }) {
  return { mode, current, status: "idle", version: null, url: null, progress: 0, checkedAt: null, error: null };
}

// Once an update is downloaded it waits for the user; later checks and their
// errors change nothing until then.
export function nextState(state, event) {
  if (state.status === "ready") return state;
  switch (event.type) {
    case "checking":
      return { ...state, status: "checking", error: null };
    case "current":
      return { ...state, status: "current", checkedAt: event.at, error: null };
    case "available":
      return {
        ...state,
        status: state.mode === "install" ? "downloading" : "available",
        version: event.version,
        url: event.url,
        progress: 0,
        checkedAt: event.at,
        error: null,
      };
    case "progress":
      return { ...state, progress: Math.floor(event.percent) };
    case "ready":
      return { ...state, status: "ready", version: event.version, progress: 100 };
    case "error":
      return { ...state, status: "error", error: event.message };
    default:
      return state;
  }
}

// A check is pointless while one runs, while a download is under way, or
// once an update is waiting.
export function canCheck(state) {
  return state.mode !== "off" && !["checking", "downloading", "ready"].includes(state.status);
}
