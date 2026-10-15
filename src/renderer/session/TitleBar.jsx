import CaptionButtons from "../shared/CaptionButtons.jsx";
import Money from "../shared/Money.jsx";
import { statusAppearance } from "../shared/statusStates.js";

function Icon({ path }) {
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
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  tray: "M2 4h12M2 8h12M2 12h12",
  pin: "M9.5 2l4.5 4.5-2.5 1-2 4.5L7.5 10 3 14.5 2 13.5 6.5 9 4.5 7l4.5-2z",
  lock: "M4 7V5a4 4 0 0 1 8 0v2M3 7h10v7H3z",
};

function Control({ icon, label, active, onClick }) {
  return (
    <button
      type="button"
      className={`title-bar__control${active ? " is-active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon path={ICONS[icon]} />
    </button>
  );
}

export default function TitleBar({ session, chrome, trayOpen, onToggleTray, onTogglePin, onToggleLock }) {
  const { profile, telemetry } = session;
  const { label, color, text } = statusAppearance(telemetry.state, session.settings?.statusAppearance);
  return (
    <header className="title-bar">
      <span className="title-bar__name">{profile.name}</span>
      <span className="state-pill" style={{ background: color, color: text }}>
        {label}
        {telemetry.currentTool && <span className="state-pill__tool">{telemetry.currentTool}</span>}
      </span>
      <span className="title-bar__meta">{telemetry.model?.name ?? profile.model}</span>
      <span className="title-bar__meta">{profile.cwd}</span>
      <span className="title-bar__facts">
        <Money usd={telemetry.totalCostUsd} fx={session.fx} />
        {telemetry.contextPct !== null && <span>ctx {Math.round(telemetry.contextPct)}%</span>}
      </span>
      <span className="title-bar__controls">
        <Control icon="tray" label="Activity tray" active={trayOpen} onClick={onToggleTray} />
        <Control icon="pin" label="Always on top" active={chrome.pinned} onClick={onTogglePin} />
        <Control icon="lock" label="Close lock" active={chrome.locked} onClick={onToggleLock} />
      </span>
      <CaptionButtons platform={session.platform} maximized={chrome.maximized} />
    </header>
  );
}
