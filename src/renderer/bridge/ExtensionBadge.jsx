// The title bar's word on Hekaton's GNOME Shell extension, which arranging,
// pinning and focusing windows need on GNOME: a button to install or update
// it, then a reminder that GNOME only loads it at the next login. Nothing
// once it runs, or anywhere but GNOME.
export default function ExtensionBadge({ status }) {
  if (status === "missing" || status === "outdated") {
    return (
      <button
        type="button"
        className="update-badge update-badge--action"
        title="Arranging, pinning and focusing windows on GNOME need Hekaton's GNOME Shell extension"
        onClick={() => window.hekaton.bridge.installExtension()}
      >
        {status === "missing" ? "Install GNOME extension" : "Update GNOME extension"}
      </button>
    );
  }
  if (status === "login") {
    return (
      <span className="update-badge" role="status" title="GNOME loads the extension when you next log in">
        Log out and back in to finish
      </span>
    );
  }
  return null;
}
