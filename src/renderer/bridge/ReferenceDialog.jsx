import { useCallback, useEffect, useRef, useState } from "react";

const TABS = [
  { kind: "command", label: "Slash Commands" },
  { kind: "skill", label: "Skills" },
  { kind: "agent", label: "Agents" },
];

function Entry({ entry }) {
  const facts = [
    entry.invocation && ["Invoke", entry.invocation],
    entry.model && ["Model", entry.model],
    entry.tools && ["Tools", entry.tools],
    entry.argumentHint && ["Args", entry.argumentHint],
    entry.kind !== "agent" && !entry.modelInvocable && ["", "user-invoked only"],
  ].filter(Boolean);
  return (
    <article className="ref-entry">
      <header className="ref-entry__head">
        <span className="ref-entry__name">{entry.name}</span>
        <button type="button" onClick={() => window.hekaton.bridge.openPath(entry.file)} title={entry.file}>
          Open
        </button>
      </header>
      {facts.length > 0 && (
        <p className="ref-entry__facts">
          {facts.map(([label, value]) => (
            <span key={label + value}>
              {label && <strong>{label}: </strong>}
              {value}
            </span>
          ))}
        </p>
      )}
      {entry.description && <p className="ref-entry__description">{entry.description}</p>}
      {entry.preview && <pre className="ref-entry__preview">{entry.preview}</pre>}
    </article>
  );
}

// Skills, agents and slash commands found on this PC, grouped by where
// they came from, with the file one click away.
export default function ReferenceDialog({ initialKind, settings, onClose }) {
  const [kind, setKind] = useState(initialKind ?? "command");
  const [entries, setEntries] = useState(null);
  const { bridge } = window.hekaton;

  const rescan = useCallback(() => {
    setEntries(null);
    bridge.reference().then(setEntries);
  }, [bridge]);

  // The Bridge re-renders on every state broadcast with a fresh onClose, so
  // the callback lives in a ref and the scan runs once per opening.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    rescan();
    const onKey = (event) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rescan]);

  async function addPath() {
    const folder = await bridge.pickFolder();
    if (!folder) return;
    const referenceRoots = [...new Set([...(settings.referenceRoots ?? []), folder])];
    await bridge.saveSettings({ referenceRoots });
    rescan();
  }

  const shown = (entries ?? []).filter((entry) => entry.kind === kind);
  const groups = [...new Set(shown.map((entry) => entry.source))];

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-label="Claude reference"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <span className="dialog__title">Claude Reference</span>
          <button type="button" className="dialog__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <nav className="tabs" aria-label="Reference kinds">
          {TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              className={`tabs__tab${kind === tab.kind ? " is-active" : ""}`}
              aria-pressed={kind === tab.kind}
              onClick={() => setKind(tab.kind)}
            >
              {tab.label}
            </button>
          ))}
          <span className="tabs__tools">
            <button type="button" onClick={addPath} title="Add a folder to scan">
              + Add path
            </button>
            <button type="button" onClick={rescan} title="Scan again">
              ↻ Rescan
            </button>
          </span>
        </nav>
        <div className="dialog__list">
          {entries === null && <p className="dialog__empty">Scanning…</p>}
          {entries !== null && shown.length === 0 && <p className="dialog__empty">Nothing found for this kind.</p>}
          {groups.map((source) => (
            <section key={source} className="ref-group">
              <h2 className="ref-group__title">{source}</h2>
              {shown
                .filter((entry) => entry.source === source)
                .map((entry) => (
                  <Entry key={entry.file} entry={entry} />
                ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
