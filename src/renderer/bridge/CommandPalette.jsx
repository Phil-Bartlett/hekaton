import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ACCENT } from "./ProfilesRail.jsx";

const MAX_RESULTS = 12;

function matches(haystack, needle) {
  return haystack.toLowerCase().includes(needle);
}

// Everything the palette can jump to: a session (by name, folder, any
// prompt it has run), an external session, or a profile to launch.
function buildIndex(state) {
  const items = [];
  for (const session of state.sessions) {
    const prompts = (session.activity ?? []).map((turn) => turn.prompt);
    items.push({
      key: `session:${session.id}`,
      kind: "Session",
      title: session.profile.name,
      detail: session.telemetry.lastPrompt ?? session.profile.cwd,
      accent: session.profile.accent ?? DEFAULT_ACCENT,
      text: [session.profile.name, session.profile.cwd, ...prompts].join("\n"),
      run: () => window.hekaton.bridge.focus(session.id),
    });
    for (const prompt of prompts.slice(-20)) {
      items.push({
        key: `prompt:${session.id}:${prompt}`,
        kind: "Prompt",
        title: prompt,
        detail: `in ${session.profile.name}`,
        accent: session.profile.accent ?? DEFAULT_ACCENT,
        text: prompt,
        run: () => window.hekaton.bridge.focus(session.id),
        promptOnly: true,
      });
    }
  }
  for (const entry of state.dormant) {
    items.push({
      key: `saved:${entry.id}`,
      kind: "Saved",
      title:
        entry.title && entry.title !== entry.profileName ? `${entry.profileName} · ${entry.title}` : entry.profileName,
      detail: entry.lastPrompt ?? entry.firstPrompt ?? entry.cwd,
      accent: entry.accent ?? DEFAULT_ACCENT,
      text: [entry.profileName, entry.title, entry.cwd, entry.firstPrompt, entry.lastPrompt].filter(Boolean).join("\n"),
      run: entry.claudeSessionId ? () => window.hekaton.bridge.resumeInstance(entry.id) : null,
    });
  }
  for (const external of state.external) {
    items.push({
      key: `external:${external.sessionId}`,
      kind: "Outside Hekaton",
      title: external.name ?? external.cwd ?? `pid ${external.pid}`,
      detail: external.cwd ?? "",
      accent: "#555555",
      text: [external.name, external.cwd].filter(Boolean).join("\n"),
      run: null,
    });
  }
  for (const profile of state.profiles) {
    items.push({
      key: `profile:${profile.id}`,
      kind: "Launch",
      title: profile.name,
      detail: profile.cwd,
      accent: profile.accent ?? DEFAULT_ACCENT,
      text: `${profile.name}\n${profile.cwd}`,
      run: () => window.hekaton.bridge.launch(profile.id),
    });
  }
  return items;
}

export default function CommandPalette({ state, onClose }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const index = useMemo(() => buildIndex(state), [state]);
  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    const hits = index.filter((item) => (needle ? matches(item.text, needle) : !item.promptOnly));
    return hits.slice(0, MAX_RESULTS);
  }, [index, needle]);

  useEffect(() => setCursor(0), [needle]);

  function choose(item) {
    if (!item?.run) return;
    item.run();
    closeRef.current();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") closeRef.current();
    else if (event.key === "ArrowDown") setCursor((c) => Math.min(c + 1, results.length - 1));
    else if (event.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
    else if (event.key === "Enter") choose(results[cursor]);
    else return;
    event.preventDefault();
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog palette"
        role="dialog"
        aria-label="Find a session"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          className="palette__input"
          placeholder="Find a session, a prompt, or a profile to launch…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <ul className="palette__list" role="listbox">
          {results.length === 0 && <li className="palette__empty">No matches.</li>}
          {results.map((item, i) => (
            <li
              key={item.key}
              role="option"
              aria-selected={i === cursor}
              className={`palette__item${i === cursor ? " is-active" : ""}${item.run ? "" : " is-inert"}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(item)}
            >
              <span className="palette__dot" style={{ background: item.accent }} />
              <span className="palette__kind">{item.kind}</span>
              <span className="palette__title">{item.title}</span>
              <span className="palette__detail">{item.detail}</span>
            </li>
          ))}
        </ul>
        <footer className="palette__foot">↑↓ move · Enter open · Esc close</footer>
      </div>
    </div>
  );
}
