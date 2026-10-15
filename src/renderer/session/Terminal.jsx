import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

// ESC CR is what `/terminal-setup` binds Shift+Enter to in VS Code: Claude
// Code reads it as "newline inside the prompt" rather than "submit".
const SHIFT_ENTER_SEQUENCE = "\x1b\r";

function handleKey(term, event) {
  if (event.type !== "keydown") return true;
  if (event.key === "Enter" && event.shiftKey) {
    window.hekaton.pty.write(SHIFT_ENTER_SEQUENCE);
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

export default function Terminal({ theme, platform, osBuild }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: "'Cascadia Mono', Consolas, Menlo, monospace",
      fontSize: 14,
      scrollback: 10000,
      theme,
      ...(platform === "win32" && { windowsPty: { backend: "conpty", buildNumber: osBuild } }),
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL context: xterm falls back to its DOM renderer.
    }
    term.attachCustomKeyEventHandler((event) => handleKey(term, event));

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
    };
    // The terminal is created once; theme changes are applied by the effect below.
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = theme;
  }, [theme]);

  return <div className="terminal-host" ref={hostRef} />;
}
