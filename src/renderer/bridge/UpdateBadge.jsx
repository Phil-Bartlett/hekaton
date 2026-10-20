import { formatClock } from "../shared/format.js";

// The title bar's word on updates: nothing while there is nothing to say,
// progress while a release downloads, then a button to restart into it, or
// a link to its page where Hekaton cannot install it itself.
export default function UpdateBadge({ update }) {
  if (update?.status === "downloading") {
    return (
      <span className="update-badge" role="status">
        Downloading {update.version}… {update.progress}%
      </span>
    );
  }
  if (update?.status === "ready") {
    return (
      <button
        type="button"
        className="update-badge update-badge--action"
        title="Restart Hekaton into the new version"
        onClick={() => window.hekaton.bridge.installUpdate()}
      >
        {update.version} ready – Restart
      </button>
    );
  }
  if (update?.status === "available") {
    return (
      <button
        type="button"
        className="update-badge update-badge--action"
        title="Open the release page to download it"
        onClick={() => window.hekaton.link.open(update.url)}
      >
        {update.version} available
      </button>
    );
  }
  return null;
}

// One line on where updating stands, for Settings.
export function updateStatusText(update) {
  switch (update.status) {
    case "checking":
      return "Checking for updates…";
    case "current":
      return `Up to date; last checked at ${formatClock(update.checkedAt)}.`;
    case "downloading":
      return `Downloading ${update.version}… ${update.progress}%`;
    case "ready":
      return `${update.version} is downloaded; restart Hekaton to install it.`;
    case "available":
      return `${update.version} is available from the release page.`;
    case "error":
      return `The last check failed: ${update.error}`;
    default:
      return update.mode === "off" ? "A development build does not update itself." : "Not checked yet.";
  }
}
