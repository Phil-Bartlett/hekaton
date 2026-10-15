import { useEffect, useRef, useState } from "react";
import { applyTheme, resolveTheme } from "../shared/themes.js";
import ActivityTray from "./ActivityTray.jsx";
import FindBar from "./FindBar.jsx";
import Terminal from "./Terminal.jsx";
import TitleBar from "./TitleBar.jsx";

const DEFAULT_ACCENT = "#3b82f6";
const DEFAULT_FONT = "'Cascadia Mono', Consolas, Menlo, monospace";

function terminalTheme(theme) {
  return {
    background: theme.bg,
    foreground: theme.fg,
    cursor: theme.fg,
    selectionBackground: "#3a3d41",
  };
}

export default function App() {
  const [session, setSession] = useState(null);
  const [activity, setActivity] = useState([]);
  const [chrome, setChrome] = useState({ pinned: false, locked: false });
  const [trayOpen, setTrayOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [exitCode, setExitCode] = useState(null);
  const searchRef = useRef(null);

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
    applyTheme(resolveTheme(session.settings?.theme, session.settings?.customThemes));
  }, [session]);

  if (!session) return null;

  const theme = resolveTheme(session.settings?.theme, session.settings?.customThemes);
  const font = session.settings?.terminal ?? {};

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
          {findOpen && <FindBar search={searchRef} onClose={() => setFindOpen(false)} />}
          <Terminal
            theme={terminalTheme(theme)}
            fontFamily={font.fontFamily || DEFAULT_FONT}
            fontSize={font.fontSize || 14}
            platform={session.platform}
            osBuild={session.osBuild}
            searchRef={searchRef}
            onFind={() => setFindOpen(true)}
          />
          {exitCode !== null && <div className="exit-banner">Claude exited with code {exitCode}</div>}
        </div>
        {trayOpen && <ActivityTray turns={activity} fx={session.fx} />}
      </main>
    </>
  );
}
