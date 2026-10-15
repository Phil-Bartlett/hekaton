import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

// ESC CR is what `/terminal-setup` binds Shift+Enter to in VS Code: Claude
// Code reads it as "newline inside the prompt" rather than "submit".
const SHIFT_ENTER_SEQUENCE = "\x1b\r";

function handleKey(term, event, onFind) {
  if (event.type !== "keydown") return true;
  if (event.key === "Enter" && event.shiftKey) {
    window.hekaton.pty.write(SHIFT_ENTER_SEQUENCE);
    return false;
  }
  // Ctrl/Cmd+F or +K opens the find bar instead of reaching Claude.
  if ((event.ctrlKey || event.metaKey) && ["f", "k"].includes(event.key.toLowerCase())) {
    onFind();
    return false;
  }
  // Ctrl+C copies when there is a selection, as Windows Terminal does;
  // otherwise it reaches Claude as the interrupt it expects.
  if (event.ctrlKey && !event.shiftKey && event.key === "c" && term.hasSelection()) {
    navigator.clipboard.writeText(term.getSelection());
    term.clearSelection();
    return false;
  }
  return true;
}

export default function Terminal({ theme, fontFamily, fontSize, platform, osBuild, searchRef, onFind }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const onFindRef = useRef(onFind);
  onFindRef.current = onFind;

  useEffect(() => {
    const term = new XTerm({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily,
      fontSize,
      scrollback: 10000,
      theme,
      ...(platform === "win32" && { windowsPty: { backend: "conpty", buildNumber: osBuild } }),
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    if (searchRef) {
      const options = (extra) => ({
        caseSensitive: false,
        decorations: {
          matchOverviewRuler: "#f59e0b",
          activeMatchColorOverviewRuler: "#f59e0b",
          matchBackground: "#5a4a10",
          activeMatchBackground: "#f59e0b",
        },
        ...extra,
      });
      searchRef.current = {
        findNext: (query, extra) => search.findNext(query, options(extra)),
        findPrevious: (query, extra) => search.findPrevious(query, options(extra)),
        clear: () => search.clearDecorations(),
      };
    }
    term.open(hostRef.current);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL context: xterm falls back to its DOM renderer.
    }
    term.attachCustomKeyEventHandler((event) => handleKey(term, event, () => onFindRef.current?.()));

    // Subscribe before attaching: the attach reply carries everything drawn
    // so far, and live chunks only start flowing after it.
    const offData = window.hekaton.pty.onData((data) => term.write(data));
    const input = term.onData((data) => window.hekaton.pty.write(data));
    const resize = term.onResize(({ cols, rows }) => window.hekaton.pty.resize(cols, rows));
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(hostRef.current);
    fit.fit();
    term.focus();
    window.hekaton.pty.attach().then((scrollback) => {
      if (scrollback) term.write(scrollback);
    });

    return () => {
      observer.disconnect();
      offData();
      input.dispose();
      resize.dispose();
      term.dispose();
      termRef.current = null;
      if (searchRef) searchRef.current = null;
    };
    // The terminal is created once; theme changes are applied by the effect below.
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = theme;
  }, [theme]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
  }, [fontFamily, fontSize]);

  return <div className="terminal-host" ref={hostRef} />;
}
