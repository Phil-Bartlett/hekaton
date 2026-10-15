// Minimise / maximise / close for platforms without native buttons on our
// title bar. macOS keeps its traffic lights, so nothing is drawn there.
function Glyph({ children }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const GLYPHS = {
  minimize: (
    <Glyph>
      <path d="M0 5h10" />
    </Glyph>
  ),
  maximize: (
    <Glyph>
      <rect x="0.5" y="0.5" width="9" height="9" />
    </Glyph>
  ),
  restore: (
    <Glyph>
      <path d="M2.5 2.5V0.5h7v7h-2" />
      <rect x="0.5" y="2.5" width="7" height="7" />
    </Glyph>
  ),
  close: (
    <Glyph>
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </Glyph>
  ),
};

export default function CaptionButtons({ platform, maximized }) {
  if (platform === "darwin") return null;
  const control = (action) => () => window.hekaton.window.control(action);
  return (
    <span className="caption" role="group" aria-label="Window controls">
      <button type="button" className="caption__button" aria-label="Minimise" onClick={control("minimize")}>
        {GLYPHS.minimize}
      </button>
      <button
        type="button"
        className="caption__button"
        aria-label={maximized ? "Restore" : "Maximise"}
        onClick={control("maximize")}
      >
        {maximized ? GLYPHS.restore : GLYPHS.maximize}
      </button>
      <button
        type="button"
        className="caption__button caption__button--close"
        aria-label="Close"
        onClick={control("close")}
      >
        {GLYPHS.close}
      </button>
    </span>
  );
}
