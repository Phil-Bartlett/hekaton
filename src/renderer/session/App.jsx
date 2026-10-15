import { useEffect, useState } from "react";
import ActivityTray from "./ActivityTray.jsx";
import Terminal from "./Terminal.jsx";
import TitleBar from "./TitleBar.jsx";

const DEFAULT_ACCENT = "#3b82f6";

const TERMINAL_THEME = {
  background: "#1a1a1a",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  selectionBackground: "#3a3d41",
};

export default function App() {
  const [session, setSession] = useState(null);
  const [activity, setActivity] = useState([]);
  const [chrome, setChrome] = useState({ pinned: false, locked: false });
  const [trayOpen, setTrayOpen] = useState(false);
  const [exitCode, setExitCode] = useState(null);

  useEffect(() => {
    const { hekaton } = window;
    hekaton.session.get().then((initial) => {
      setSession(initial);
      setActivity(initial.activity ?? []);
      setTrayOpen(initial.profile.openTray === true);
    });
    const unsubscribe = [
      hekaton.session.onUpdate((next) => setSession((current) => ({ ...current, ...next }))),
      hekaton.session.onActivity(setActivity),
      hekaton.window.onChrome(setChrome),
      hekaton.pty.onExit(setExitCode),
    ];
    return () => unsubscribe.forEach((off) => off());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.window = "session";
    if (!session) return;
    root.style.setProperty("--accent", session.profile.accent ?? DEFAULT_ACCENT);
    root.dataset.platform = session.platform;
    root.dataset.colorScope = session.profile.colorScope ?? "border+title";
  }, [session]);

  if (!session) return null;

  return (
    <>
      <TitleBar
        session={session}
        chrome={chrome}
        trayOpen={trayOpen}
        onToggleTray={() => setTrayOpen((open) => !open)}
        onTogglePin={() => window.hekaton.window.pin(!chrome.pinned)}
        onToggleLock={() => window.hekaton.window.closeLock(!chrome.locked)}
      />
      <main className="session-body">
        <div className="terminal-pane">
          <Terminal theme={TERMINAL_THEME} platform={session.platform} osBuild={session.osBuild} />
          {exitCode !== null && <div className="exit-banner">Claude exited with code {exitCode}</div>}
        </div>
        {trayOpen && <ActivityTray turns={activity} fx={session.fx} />}
      </main>
    </>
  );
}
