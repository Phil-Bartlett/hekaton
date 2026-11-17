import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

// ESC CR is what `/terminal-setup` binds Shift+Enter to in VS Code: Claude
// Code reads it as "newline inside the prompt" rather than "submit".
const SHIFT_ENTER_SEQUENCE = "\x1b\r";

// OSC 52 is how Claude Code (and other TUIs) copy to the system clipboard
// through the terminal. xterm has no built-in handler, so the write is dropped
// and the clipboard keeps its previous contents. Decode "Pc;<base64>" and send
// the text to the native clipboard; a "?" payload is a read request we ignore.
function writeOsc52ToClipboard(data) {
  const separator = data.indexOf(";");
  if (separator === -1) return true;
  const encoded = data.slice(separator + 1);
  if (!encoded || encoded === "?") return true;
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    if (text) window.hekaton.clipboard.write(text);
  } catch {
    // Not valid base64: nothing to copy.
  }
  return true;
}

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
    window.hekaton.clipboard.write(term.getSelection());
    term.clearSelection();
    // Stop the browser's own copy of the selection, which would otherwise put
    // the same text on the clipboard a second time.
    event.preventDefault();
    return false;
  }
  // Ctrl/Cmd+V pastes (this is also how the Windows clipboard history delivers
  // a picked entry). xterm otherwise swallows Ctrl+V as a control character and
  // the browser's paste never fires, so read the clipboard ourselves and paste
  // it through xterm; an image is left to Claude via the raw control char.
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "v") {
    window.hekaton.clipboard.read().then(({ text, hasImage }) => {
      if (hasImage) window.hekaton.pty.write("\x16");
      else if (text) term.paste(text);
    });
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
    term.loadAddon(new WebLinksAddon((event, url) => window.hekaton.link.open(url)));
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
    const osc52 = term.parser.registerOscHandler(52, writeOsc52ToClipboard);

    // xterm 6 draws a VS Code style overlay scrollbar that fades out half a
    // second after the pointer leaves it, so a mouse without a wheel has no
    // way back into the scrollback. Flag the host while there is anything
    // above the viewport; session.css then keeps the scrollbar on show.
    const showScrollbar = () => hostRef.current?.classList.toggle("has-scrollback", term.buffer.active.baseY > 0);
    const scrollbarWatch = [
      term.onScroll(showScrollbar),
      term.onLineFeed(showScrollbar),
      term.buffer.onBufferChange(showScrollbar),
    ];

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

    // Paste (Ctrl+V, right-click, the Windows clipboard history) only reaches
    // the terminal while its hidden textarea holds focus; switching to another
    // window or the clipboard-history flyout blurs it, so refocus when this
    // window comes back and on any click in the pane. The find input keeps its
    // focus, so a search in progress is left alone.
    const refocus = () => {
      if (!termRef.current || document.activeElement?.tagName === "INPUT") return;
      termRef.current.focus();
    };
    // Returning from another window or the clipboard-history flyout, the OS
    // delivers the paste a beat after focus returns, so defer a frame to be the
    // target by then.
    const refocusLater = () => requestAnimationFrame(refocus);
    window.addEventListener("focus", refocusLater);
    hostRef.current.addEventListener("mousedown", refocus);

    // Dropping files onto the terminal inserts their paths, so a file can be
    // handed to Claude by dragging it in. Paths with spaces are quoted; paste
    // goes through xterm so bracketed-paste mode is respected.
    const onDragOver = (event) => event.preventDefault();
    const onDrop = (event) => {
      event.preventDefault();
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      if (dropped.length === 0 || !termRef.current) return;
      const paths = dropped
        .map((file) => window.hekaton.files.pathFor(file))
        .filter(Boolean)
        .map((filePath) => (/\s/.test(filePath) ? `"${filePath}"` : filePath));
      if (paths.length === 0) return;
      termRef.current.focus();
      termRef.current.paste(paths.join(" "));
    };
    // On the window, not the host: a drop anywhere in the session feeds the
    // terminal, and preventing the default stops Electron navigating to the
    // dropped file.
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);

    return () => {
      observer.disconnect();
      scrollbarWatch.forEach((watch) => watch.dispose());
      window.removeEventListener("focus", refocusLater);
      hostRef.current?.removeEventListener("mousedown", refocus);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      offData();
      input.dispose();
      resize.dispose();
      osc52.dispose();
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
