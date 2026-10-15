import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ProfileEditor from "./ProfileEditor.jsx";
import ProfilesRail from "./ProfilesRail.jsx";
import SessionCard, { ExternalSessionCard } from "./SessionCard.jsx";
import CaptionButtons from "../shared/CaptionButtons.jsx";
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
          <SessionCard key={session.id} session={session} now={now} />
        ))}
        {state.external.map((session) => (
          <ExternalSessionCard key={session.sessionId} session={session} now={now} />
        ))}
        {empty && <p className="cards__empty">No sessions running. Open a profile to start one.</p>}
      </section>
    </>
  );
}

function App() {
  const state = useBridgeState();
  const [editing, setEditing] = useState(null);
  const [chrome, setChrome] = useState({ maximized: false });

  useEffect(() => {
    document.documentElement.dataset.window = "bridge";
    return window.hekaton.window.onChrome(setChrome);
  }, []);

  useEffect(() => {
    if (state) document.documentElement.dataset.platform = state.platform;
  }, [state]);

  if (!state) return null;

  return (
    <>
      <header className="title-bar">
        <span className="title-bar__name">Hekaton</span>
        <CaptionButtons platform={state.platform} maximized={chrome.maximized} />
      </header>
      <main className="bridge">
        {editing ? (
          <ProfileEditor profile={editing} onClose={() => setEditing(null)} />
        ) : (
          <Dashboard state={state} onEditProfile={setEditing} onNewProfile={() => setEditing({})} />
        )}
      </main>
      <footer className="status-bar">
        <span className="status-bar__version">v{state.version}</span>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
