import { useEffect, useRef, useState } from "react";
import { formatAge } from "../shared/format.js";

// Named window arrangements: save where every live window sits now, then
// put them back later. Layouts follow the cards, so one still applies after
// a relaunch to whichever of its cards have been resumed.
export default function LayoutsDialog({ layouts, liveCount, onClose }) {
  const [name, setName] = useState("");
  const now = Date.now();
  const { bridge } = window.hekaton;

  // onClose is recreated on every Bridge broadcast; keep it in a ref so the
  // listener is registered once per opening.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function save(event) {
    event.preventDefault();
    if (!name.trim()) return;
    await bridge.saveLayout(name);
    setName("");
  }

  function apply(id) {
    bridge.applyLayout(id);
    closeRef.current();
  }

  const newestFirst = [...layouts].sort((a, b) => b.savedAt - a.savedAt);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Saved layouts" onClick={(event) => event.stopPropagation()}>
        <header className="dialog__head">
          <span className="dialog__title">Saved Layouts</span>
          <button type="button" className="dialog__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <form className="dialog__toolbar" onSubmit={save}>
          <input
            className="dialog__filter"
            aria-label="Layout name"
            placeholder="Name where the windows are now…"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <button type="submit" disabled={!name.trim() || liveCount === 0}>
            Save current
          </button>
        </form>
        <div className="dialog__list">
          {newestFirst.length === 0 && (
            <p className="dialog__empty">No saved layouts yet. Arrange the windows, name it above and save.</p>
          )}
          {newestFirst.map((layout) => {
            const count = Object.keys(layout.placements).length;
            return (
              <article key={layout.id} className="history-entry">
                <header className="history-entry__head">
                  <span className="history-entry__name">{layout.name}</span>
                  <span className="history-entry__ago">{formatAge(now - layout.savedAt)} ago</span>
                </header>
                <footer className="history-entry__foot">
                  <span>
                    {count} window{count === 1 ? "" : "s"}
                  </span>
                  <span className="history-entry__actions">
                    <button type="button" onClick={() => apply(layout.id)}>
                      Apply
                    </button>
                    <button type="button" onClick={() => bridge.deleteLayout(layout.id)}>
                      Delete
                    </button>
                  </span>
                </footer>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
