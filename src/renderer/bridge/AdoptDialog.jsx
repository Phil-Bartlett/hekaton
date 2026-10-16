import { useEffect, useRef, useState } from "react";
import { formatAge } from "../shared/format.js";

function ago(epochMs, now) {
  return `${formatAge(now - epochMs)} ago`;
}

function folderName(cwd) {
  return cwd?.split(/[\/]/).filter(Boolean).pop() ?? "";
}

// Conversations Claude Code holds on this machine that the Bridge does not
// know: pick a profile and each becomes a saved card that can be resumed.
export default function AdoptDialog({ profiles, onClose }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("");
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const now = Date.now();
  const { bridge } = window.hekaton;

  // onClose is recreated on every Bridge broadcast; keep it in a ref so the
  // list loads once per opening.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    bridge.conversations().then(setRows);
    const onKey = (event) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bridge]);

  const needle = filter.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (row) =>
      !needle ||
      row.title?.toLowerCase().includes(needle) ||
      row.firstPrompt?.toLowerCase().includes(needle) ||
      row.cwd?.toLowerCase().includes(needle),
  );

  async function adopt(row) {
    const target = profileId || profiles.find((profile) => profile.cwd === row.cwd)?.id;
    if (!target) return;
    await bridge.adopt(row.sessionId, target);
    setRows((current) => current.filter((other) => other.sessionId !== row.sessionId));
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Adopt conversations"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__title">Adopt a Conversation</span>
          <button type="button" className="dialog__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="dialog__toolbar">
          <input
            className="dialog__filter"
            placeholder="Filter by title, prompt or folder…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            autoFocus
          />
          <label className="dialog__pick">
            Under profile
            <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="dialog__list">
          {rows === null && <p className="dialog__empty">Reading Claude&apos;s conversations…</p>}
          {rows !== null && shown.length === 0 && <p className="dialog__empty">Nothing new to adopt.</p>}
          {shown.map((row) => (
            <article key={row.sessionId} className="history-entry">
              <header className="history-entry__head">
                <span className="history-entry__name" title={row.cwd ?? ""}>
                  {row.title ?? folderName(row.cwd) ?? "Untitled"}
                </span>
                <span className="history-entry__ago">{ago(row.modifiedAt, now)}</span>
              </header>
              <p className="history-entry__prompt">{row.firstPrompt}</p>
              <footer className="history-entry__foot">
                <span className="history-entry__folder">{row.cwd}</span>
                <button type="button" disabled={!profileId} onClick={() => adopt(row)}>
                  Adopt
                </button>
              </footer>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
