import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import HistoryDialog from "./HistoryDialog.jsx";
import MonitorMap from "./MonitorMap.jsx";
import ProfileEditor from "./ProfileEditor.jsx";
import ProfilesRail from "./ProfilesRail.jsx";
import ReferenceDialog from "./ReferenceDialog.jsx";
import SessionCard, { ExternalSessionCard } from "./SessionCard.jsx";
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

function Dashboard({ state, onEditProfile, onNewProfile }) {
  const now = useNow();
  const { bridge } = window.hekaton;
  const empty = state.sessions.length === 0 && state.external.length === 0;
  return (
    <>
      <ProfilesRail
        profiles={state.profiles}
        onLaunch={(id) => bridge.launch(id)}
        onEdit={onEditProfile}
        onNew={onNewProfile}
      />
      <section className="cards">
        {state.sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            now={now}
            fx={state.fx}
            appearance={state.settings.statusAppearance}
          />
        ))}
        {state.external.map((session) => (
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
  const [referenceKind, setReferenceKind] = useState(null);
  const [chrome, setChrome] = useState({ maximized: false });

  useEffect(() => {
    document.documentElement.dataset.window = "bridge";
    return window.hekaton.window.onChrome(setChrome);
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
    settings: <SettingsView settings={state.settings} onClose={closeView} />,
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
      {historyOpen && <HistoryDialog fx={state.fx} onClose={() => setHistoryOpen(false)} />}
      {referenceKind && (
        <ReferenceDialog initialKind={referenceKind} settings={state.settings} onClose={() => setReferenceKind(null)} />
      )}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
