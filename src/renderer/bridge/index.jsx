import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import CommandPalette from "./CommandPalette.jsx";
import AdoptDialog from "./AdoptDialog.jsx";
import HistoryDialog from "./HistoryDialog.jsx";
import LayoutsDialog from "./LayoutsDialog.jsx";
import MonitorMap from "./MonitorMap.jsx";
import ProfileEditor from "./ProfileEditor.jsx";
import ProfilesRail from "./ProfilesRail.jsx";
import ReferenceDialog from "./ReferenceDialog.jsx";
import SessionCard, { DormantCard, ExternalSessionCard, RemoteSessionCard } from "./SessionCard.jsx";
import SettingsView from "./SettingsView.jsx";
import ExtensionBadge from "./ExtensionBadge.jsx";
import UpdateBadge from "./UpdateBadge.jsx";
import UsagePanel from "./UsagePanel.jsx";
import { TILE_LAYOUT_LABELS, liveCard, orderCards, projectOf, remoteCard, remoteDormantCard } from "./cards.js";
import CaptionButtons from "../shared/CaptionButtons.jsx";
import ErrorBoundary from "../shared/ErrorBoundary.jsx";
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
// running outside Hekaton. Counts cover live and saved cards, here and on
// the other machines sharing the data folder.
function ProfileFilter({ state, filter, onChange }) {
  const counts = new Map();
  const remote = state.hosts.flatMap((host) => [...host.sessions, ...host.dormant]);
  for (const card of [...state.sessions.map((s) => s.profile), ...state.dormant, ...remote]) {
    const name = card.profileName ?? card.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = [...new Set([...state.profiles.map((p) => p.name), ...counts.keys()])];
  const total = state.sessions.length + state.dormant.length + remote.length;
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
  ["project", "By project"],
  ["recent", "Most recent"],
];

const VIEWS = [
  ["comfortable", "Tiles"],
  ["compact", "Compact tiles"],
  ["list", "List"],
];

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

// Which machine's cards to show, offered once another machine shares the
// data folder. "all" and "local" are reserved; anything else is a host id.
function HostFilter({ state, value, onChange }) {
  if (state.hosts.length === 0) return null;
  return (
    <span className="layout-controls host-filter">
      <select aria-label="Machine" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All machines</option>
        <option value="local">{state.device.name} (here)</option>
        {state.hosts.map((host) => (
          <option key={host.id} value={host.id}>
            {host.name}
            {host.online ? "" : " (offline)"}
          </option>
        ))}
      </select>
    </span>
  );
}

// Lays the live windows on show out side by side, in card order, on the
// Bridge's display unless another is picked.
function TileControls({ state, ids }) {
  const { bridge } = window.hekaton;
  const tiling = { layout: "grid", ...state.settings.tiling };
  const [displayId, setDisplayId] = useState("");
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  return (
    <span className="layout-controls tile-controls">
      <select
        aria-label="Tile layout"
        value={tiling.layout}
        onChange={(event) => bridge.saveSettings({ tiling: { ...tiling, layout: event.target.value } })}
      >
        {TILE_LAYOUT_LABELS.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {state.displays.length > 1 && (
        <select aria-label="Tile on display" value={displayId} onChange={(event) => setDisplayId(event.target.value)}>
          <option value="">This display</option>
          {state.displays.map((display) => (
            <option key={display.id} value={display.id}>
              {display.label}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={ids.length === 0}
        title="Lay the live windows shown here out side by side"
        onClick={() => bridge.tile({ ids, displayId: displayId || null, layout: tiling.layout })}
      >
        Tile
      </button>
      <button
        type="button"
        disabled={!state.canUndoTile}
        title="Put the windows back where they were before the last tile"
        onClick={() => bridge.undoTile()}
      >
        Undo
      </button>
      <button type="button" title="Save or apply a named window arrangement" onClick={() => setLayoutsOpen(true)}>
        Layouts
      </button>
      {layoutsOpen && (
        <LayoutsDialog
          layouts={state.settings.layouts}
          liveCount={state.sessions.length}
          onClose={() => setLayoutsOpen(false)}
        />
      )}
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
  const [hostFilter, setHostFilter] = useState("all");
  const showOwn = filter !== EXTERNAL_FILTER;
  const showLocal = showOwn && (hostFilter === "all" || hostFilter === "local");
  const byProfile = (name) => filter === "all" || filter === name;
  const live = showLocal ? state.sessions.filter((s) => byProfile(s.profile.name)).map(liveCard) : [];
  const dormant = showLocal
    ? state.dormant.filter((d) => byProfile(d.profileName)).map((d) => ({ kind: "dormant", ...d, entry: d }))
    : [];
  // A card recorded before machines were told apart may sit in two state
  // files; the local copy is the one to show.
  const own = new Set([...state.sessions.map((s) => s.id), ...state.dormant.map((d) => d.id)]);
  const remote = showOwn
    ? state.hosts
        .filter((host) => hostFilter === "all" || hostFilter === host.id)
        .flatMap((host) => [
          ...host.sessions.filter((s) => byProfile(s.profileName) && !own.has(s.id)).map((s) => remoteCard(host, s)),
          ...host.dormant
            .filter((e) => byProfile(e.profileName) && !own.has(e.id))
            .map((e) => remoteDormantCard(host, e)),
        ])
    : [];
  const cards = orderCards([...live, ...dormant, ...remote], state.order, layout.sort);
  const external =
    (filter === "all" || filter === EXTERNAL_FILTER) && (hostFilter === "all" || hostFilter === "local")
      ? state.external
      : [];
  const empty = cards.length === 0 && external.length === 0;
  // A request sent to another machine about this card, until it answers.
  const pendingFor = (id) => state.pending.find((entry) => entry.cardId === id) ?? null;

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
        <HostFilter state={state} value={hostFilter} onChange={setHostFilter} />
        <TileControls state={state} ids={cards.filter((card) => card.kind === "live").map((card) => card.id)} />
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
        {cards.map((card, index) => {
          const drag = { ...dragProps(card.id), className: dragClass(card.id) };
          // In project order, a full-width header opens each new repository.
          const header =
            layout.sort === "project" && projectOf(card) !== (index > 0 ? projectOf(cards[index - 1]) : null) ? (
              <h2 key={`group-${projectOf(card)}`} className="cards__group">
                {projectOf(card)}
              </h2>
            ) : null;
          const body =
            card.kind === "live" ? (
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
            ) : card.kind === "remote" ? (
              <RemoteSessionCard
                key={card.id}
                host={card.host}
                session={card.session}
                now={now}
                fx={state.fx}
                appearance={state.settings.statusAppearance}
                showNames={showNames}
                drag={drag}
                pending={pendingFor(card.id)}
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
                pending={pendingFor(card.id)}
              />
            );
          return header ? [header, body] : body;
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
    if (state.windowManager) document.documentElement.dataset.wm = state.windowManager;
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
    settings: (
      <SettingsView settings={state.settings} dataFolder={state.dataFolder} update={state.update} onClose={closeView} />
    ),
  }[view.name];

  return (
    <>
      <header className="title-bar">
        <span className="title-bar__name">Hekaton</span>
        <span className="title-bar__tools">
          <ExtensionBadge status={state.extension} />
          <UpdateBadge update={state.update} />
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
          <button type="button" onClick={() => setReferenceKind("memory")}>
            Memory
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

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
