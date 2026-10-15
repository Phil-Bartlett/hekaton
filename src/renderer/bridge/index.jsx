import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import CommandPalette from "./CommandPalette.jsx";
import AdoptDialog from "./AdoptDialog.jsx";
import HistoryDialog from "./HistoryDialog.jsx";
import MonitorMap from "./MonitorMap.jsx";
import ProfileEditor from "./ProfileEditor.jsx";
import ProfilesRail from "./ProfilesRail.jsx";
import ReferenceDialog from "./ReferenceDialog.jsx";
import SessionCard, { DormantCard, ExternalSessionCard } from "./SessionCard.jsx";
import SettingsView from "./SettingsView.jsx";
import UsagePanel from "./UsagePanel.jsx";
import CaptionButtons from "../shared/CaptionButtons.jsx";
import { applyTheme, resolveTheme } from "../shared/themes.js";
import "../shared/theme.css";
import "./bridge.css";

// The Bridge never keeps its own copy of session state: main pushes a full
// snapshot on every change and this hook simply holds the latest one.
function useBridgeState() {
  const [state, setState] = useState(null);
  useEffect(() => {
    window.hekaton.bridge.getState().then(setState);
    return window.hekaton.bridge.onState(setState);
  }, []);
  return state;
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const EXTERNAL_FILTER = "__external__";

// Filter row above the cards: every profile that has a card, plus sessions
// running outside Hekaton. Counts cover live and saved cards.
function ProfileFilter({ state, filter, onChange }) {
  const counts = new Map();
  for (const card of [...state.sessions.map((s) => s.profile), ...state.dormant]) {
    const name = card.profileName ?? card.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = [...new Set([...state.profiles.map((p) => p.name), ...counts.keys()])];
  const total = state.sessions.length + state.dormant.length;
  const option = (value, label, count) => (
    <button
      key={value}
      type="button"
      className={`filter__option${filter === value ? " is-active" : ""}`}
      aria-pressed={filter === value}
      onClick={() => onChange(value)}
    >
      {label}
      <span className="filter__count">{count}</span>
    </button>
  );
  return (
    <nav className="filter" aria-label="Filter sessions">
      {option("all", "All", total)}
      {names.map((name) => option(name, name, counts.get(name) ?? 0))}
      {option(EXTERNAL_FILTER, "Outside Hekaton", state.external.length)}
    </nav>
  );
}

const SORTS = [
  ["manual", "Manual order"],
  ["profile", "By profile"],
  ["recent", "Most recent"],
];
const VIEWS = [
  ["comfortable", "Tiles"],
  ["compact", "Compact tiles"],
  ["list", "List"],
];

// Live and saved cards in one list so they can be ordered together. Manual
// order comes from state.json; cards it does not mention follow, newest first.
function orderCards(cards, order, sort) {
  const recency = (card) => card.lastSeenAt ?? card.startedAt ?? 0;
  if (sort === "profile") {
    return [...cards].sort((a, b) => a.profileName.localeCompare(b.profileName) || recency(b) - recency(a));
  }
  if (sort === "recent") return [...cards].sort((a, b) => recency(b) - recency(a));
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...cards].sort((a, b) => {
    const ra = rank.get(a.id) ?? Infinity;
    const rb = rank.get(b.id) ?? Infinity;
    return ra - rb || recency(b) - recency(a);
  });
}

function LayoutControls({ layout, onChange }) {
  const select = (key, options, label) => (
    <select
      aria-label={label}
      value={layout[key]}
      onChange={(event) => onChange({ ...layout, [key]: event.target.value })}
    >
      {options.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  );
  return (
    <span className="layout-controls">
      {select("sort", SORTS, "Sort cards")}
      {select("density", VIEWS, "View")}
    </span>
  );
}

function Dashboard({ state, onEditProfile, onNewProfile }) {
  const now = useNow();
  const [filter, setFilter] = useState("all");
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const { bridge } = window.hekaton;
  const layout = { sort: "manual", density: "comfortable", ...state.settings.layout };
  const showNames = state.settings.showSessionNames !== false;
  const showOwn = filter !== EXTERNAL_FILTER;
  const showExternal = filter === "all" || filter === EXTERNAL_FILTER;
  const byProfile = (name) => filter === "all" || filter === name;
  const live = showOwn
    ? state.sessions
        .filter((s) => byProfile(s.profile.name))
        .map((s) => ({ kind: "live", id: s.id, profileName: s.profile.name, startedAt: s.startedAt, session: s }))
    : [];
  const dormant = showOwn
    ? state.dormant.filter((d) => byProfile(d.profileName)).map((d) => ({ kind: "dormant", ...d, entry: d }))
    : [];
  const cards = orderCards([...live, ...dormant], state.order, layout.sort);
  const external = showExternal ? state.external : [];
  const empty = cards.length === 0 && external.length === 0;

  // Dropping on a card takes its place: before it when dragging backwards,
  // after it when dragging forwards, so the last slot is reachable. Dropping
  // on empty space moves the card to the end.
  function reordered(ids, dragging, target) {
    const rest = ids.filter((id) => id !== dragging);
    if (!target) return [...rest, dragging];
    const from = ids.indexOf(dragging);
    const to = ids.indexOf(target);
    const at = rest.indexOf(target) + (from < to ? 1 : 0);
    rest.splice(at, 0, dragging);
    return rest;
  }

  // Drag a card onto another to take its place; only meaningful in manual order.
  function dragProps(id) {
    if (layout.sort !== "manual") return {};
    return {
      draggable: true,
      onDragStart: () => setDragging(id),
      onDragEnd: () => {
        setDragging(null);
        setDropTarget(null);
      },
      onDragOver: (event) => {
        event.preventDefault();
        if (dropTarget !== id) setDropTarget(id);
      },
      onDrop: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!dragging || dragging === id) return;
        bridge.reorder(
          reordered(
            cards.map((card) => card.id),
            dragging,
            id,
          ),
        );
        setDragging(null);
        setDropTarget(null);
      },
    };
  }
  const dragClass = (id) => `${dragging === id ? " is-dragging" : ""}${dropTarget === id ? " is-drop-target" : ""}`;

  return (
    <>
      <ProfilesRail
        profiles={state.profiles}
        onLaunch={(id) => bridge.launch(id)}
        onEdit={onEditProfile}
        onNew={onNewProfile}
      />
      <div className="filter-row">
        <ProfileFilter state={state} filter={filter} onChange={setFilter} />
        <LayoutControls layout={layout} onChange={(next) => bridge.saveSettings({ layout: next })} />
      </div>
      <section
        className={`cards${layout.density === "compact" ? " cards--compact" : ""}${layout.density === "list" ? " cards--list" : ""}`}
        onDragOver={(event) => {
          if (dragging) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!dragging) return;
          bridge.reorder(
            reordered(
              cards.map((card) => card.id),
              dragging,
              null,
            ),
          );
          setDragging(null);
          setDropTarget(null);
        }}
      >
        {cards.map((card) => {
          const drag = { ...dragProps(card.id), className: dragClass(card.id) };
          return card.kind === "live" ? (
            <SessionCard
              key={card.id}
              session={card.session}
              now={now}
              fx={state.fx}
              appearance={state.settings.statusAppearance}
              profiles={state.profiles}
              showNames={showNames}
              drag={drag}
            />
          ) : (
            <DormantCard
              key={card.id}
              entry={card.entry}
              now={now}
              fx={state.fx}
              appearance={state.settings.statusAppearance}
              profiles={state.profiles}
              showNames={showNames}
              drag={drag}
            />
          );
        })}
        {external.map((session) => (
          <ExternalSessionCard
            key={session.sessionId}
            session={session}
            now={now}
            appearance={state.settings.statusAppearance}
          />
        ))}
        {empty && <p className="cards__empty">No sessions running. Open a profile to start one.</p>}
      </section>
    </>
  );
}

function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path
        d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6M8 5v3.2l2.2 1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A card with a plus: bring a conversation onto the Bridge.
function AdoptIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M8 6v4M6 8h4" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.2" />
      <path
        d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function App() {
  const state = useBridgeState();
  const now = useNow(5000);
  const [view, setView] = useState({ name: "dashboard" });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [referenceKind, setReferenceKind] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [chrome, setChrome] = useState({ maximized: false });

  useEffect(() => {
    document.documentElement.dataset.window = "bridge";
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    const offChrome = window.hekaton.window.onChrome(setChrome);
    return () => {
      window.removeEventListener("keydown", onKey);
      offChrome();
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.platform = state.platform;
    applyTheme(resolveTheme(state.settings.theme, state.settings.customThemes));
  }, [state]);

  if (!state) return null;

  const closeView = () => setView({ name: "dashboard" });
  const main = {
    dashboard: (
      <Dashboard
        state={state}
        onEditProfile={(profile) => setView({ name: "profile", profile })}
        onNewProfile={() => setView({ name: "profile", profile: {} })}
      />
    ),
    profile: <ProfileEditor profile={view.profile} displays={state.displays} onClose={closeView} />,
    settings: <SettingsView settings={state.settings} dataFolder={state.dataFolder} onClose={closeView} />,
  }[view.name];

  return (
    <>
      <header className="title-bar">
        <span className="title-bar__name">Hekaton</span>
        <span className="title-bar__tools">
          <button
            type="button"
            className="title-bar__control"
            title="Instance history"
            aria-label="Instance history"
            onClick={() => setHistoryOpen(true)}
          >
            <HistoryIcon />
          </button>
          <button
            type="button"
            className="title-bar__control"
            title="Adopt a conversation Claude ran outside Hekaton"
            aria-label="Adopt a conversation"
            onClick={() => setAdoptOpen(true)}
          >
            <AdoptIcon />
          </button>
          <button
            type="button"
            className="title-bar__control"
            title="Settings"
            aria-label="Settings"
            aria-pressed={view.name === "settings"}
            onClick={() => setView(view.name === "settings" ? { name: "dashboard" } : { name: "settings" })}
          >
            <GearIcon />
          </button>
        </span>
        <CaptionButtons platform={state.platform} maximized={chrome.maximized} />
      </header>
      <main className="bridge">{main}</main>
      <footer className="status-bar">
        <UsagePanel usage={state.usage} fx={state.fx} now={now} />
        <MonitorMap displays={state.displays} sessions={state.sessions} />
        <nav className="status-bar__links" aria-label="Reference">
          <button type="button" onClick={() => setReferenceKind("command")}>
            Slash Commands
          </button>
          <button type="button" onClick={() => setReferenceKind("skill")}>
            Skills
          </button>
          <button type="button" onClick={() => setReferenceKind("agent")}>
            Agents
          </button>
        </nav>
        <span className="status-bar__version">v{state.version}</span>
      </footer>
      {paletteOpen && <CommandPalette state={state} onClose={() => setPaletteOpen(false)} />}
      {historyOpen && <HistoryDialog fx={state.fx} onClose={() => setHistoryOpen(false)} />}
      {adoptOpen && <AdoptDialog profiles={state.profiles} onClose={() => setAdoptOpen(false)} />}
      {referenceKind && (
        <ReferenceDialog initialKind={referenceKind} settings={state.settings} onClose={() => setReferenceKind(null)} />
      )}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
