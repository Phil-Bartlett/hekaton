import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ACCENT } from "./ProfilesRail.jsx";
import { TILE_LAYOUT_LABELS, liveIdsInOrder } from "./cards.js";

const MAX_RESULTS = 12;

function matches(haystack, needle) {
  return haystack.toLowerCase().includes(needle);
}

// Ways to tile the live windows or apply a saved layout. They lead the index
// so a search for them is never crowded out by sessions, and stay out of
// the unfiltered list.
function tileCommands(state) {
  const commands = [];
  const live = liveIdsInOrder(state);
  if (live.length > 0) {
    for (const [layout, label] of TILE_LAYOUT_LABELS) {
      commands.push({
        key: `tile:${layout}`,
        kind: "Tile",
        title: `${label}: every live window`,
        detail: `${live.length} on this display`,
        accent: "#555555",
        text: `tile ${label} windows layout arrange`,
        run: () => window.hekaton.bridge.tile({ ids: live, layout }),
        searchOnly: true,
      });
    }
    for (const saved of state.settings.layouts) {
      commands.push({
        key: `layout:${saved.id}`,
        kind: "Layout",
        title: saved.name,
        detail: "Saved layout",
        accent: "#555555",
        text: `layout ${saved.name}`,
        run: () => window.hekaton.bridge.applyLayout(saved.id),
        searchOnly: true,
      });
    }
  }
  if (state.canUndoTile) {
    commands.push({
      key: "tile:undo",
      kind: "Tile",
      title: "Undo the last tile",
      detail: "Put the windows back",
      accent: "#555555",
      text: "undo tile windows layout restore",
      run: () => window.hekaton.bridge.undoTile(),
      searchOnly: true,
    });
  }
  return commands;
}

// Everything the palette can jump to: a tiling command, a session (by name,
// folder, any prompt it has run), an external session, or a profile to launch.
export function buildIndex(state) {
  const items = tileCommands(state);
  for (const session of state.sessions) {
    const prompts = (session.activity?.turns ?? []).map((turn) => turn.prompt);
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
        searchOnly: true,
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
    const hits = index.filter((item) => (needle ? matches(item.text, needle) : !item.searchOnly));
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
