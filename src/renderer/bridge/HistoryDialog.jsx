import { useEffect, useRef, useState } from "react";
import { formatElapsed } from "../shared/format.js";
import Money from "../shared/Money.jsx";
import { DEFAULT_ACCENT } from "./ProfilesRail.jsx";

function ago(epochMs, now) {
  return `${formatElapsed(now - epochMs)} ago`;
}

export default function HistoryDialog({ fx, onClose }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState("");
  const now = Date.now();
  const { bridge } = window.hekaton;

  // onClose is recreated on every Bridge broadcast; keep it in a ref so the
  // list loads once per opening.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    bridge.history().then(setEntries);
    const onKey = (event) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bridge]);

  const needle = filter.trim().toLowerCase();
  const shown = entries.filter(
    (entry) =>
      !needle || entry.profileName?.toLowerCase().includes(needle) || entry.firstPrompt?.toLowerCase().includes(needle),
  );

  async function resume(entry) {
    await bridge.resume(entry);
    onClose();
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Instance history" onClick={(event) => event.stopPropagation()}>
        <header className="dialog__head">
          <span className="dialog__title">Instance History</span>
          <button type="button" className="dialog__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <input
          className="dialog__filter"
          placeholder="Filter by prompt or profile…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          autoFocus
        />
        <div className="dialog__list">
          {shown.length === 0 && <p className="dialog__empty">No finished sessions yet.</p>}
          {shown.map((entry) => (
            <article key={`${entry.endedAt}-${entry.claudeSessionId ?? ""}`} className="history-entry">
              <header className="history-entry__head">
                <span className="history-entry__dot" style={{ background: entry.accent ?? DEFAULT_ACCENT }} />
                <span className="history-entry__name">{entry.profileName}</span>
                <span className="history-entry__ago">{ago(entry.endedAt, now)}</span>
              </header>
              <p className="history-entry__prompt">{entry.firstPrompt ?? <em>No prompt</em>}</p>
              <footer className="history-entry__foot">
                <Money usd={entry.totalCostUsd} fx={fx} />
                <button
                  type="button"
                  disabled={!entry.claudeSessionId}
                  title={entry.claudeSessionId ? "Resume this conversation" : "Nothing to resume"}
                  onClick={() => resume(entry)}
                >
                  Resume
                </button>
              </footer>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
