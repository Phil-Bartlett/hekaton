import { formatElapsed } from "../shared/format.js";
import Money from "../shared/Money.jsx";
import { statusAppearance } from "../shared/statusStates.js";
import { DEFAULT_ACCENT } from "./ProfilesRail.jsx";

function StateBar({ state, detail, since, now, appearance }) {
  const { label, color, text } = statusAppearance(state, appearance);
  return (
    <div className="card__state" style={{ background: color, color: text }}>
      <span className="card__state-label">
        {label}
        {detail && <span className="card__state-detail"> · {detail}</span>}
      </span>
      {since && <span className="card__elapsed">{formatElapsed(now - since)}</span>}
    </div>
  );
}

function ContextBar({ pct }) {
  const value = pct === null ? 0 : Math.round(pct);
  return (
    <div className="card__context">
      <span>Context</span>
      <div className="bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className="bar__fill" style={{ width: `${value}%` }} />
      </div>
      <span className="card__context-pct">{value}%</span>
    </div>
  );
}

export default function SessionCard({ session, now, fx, appearance }) {
  const { id, profile, telemetry } = session;
  const { bridge } = window.hekaton;
  return (
    <article className="card" style={{ "--accent": profile.accent ?? DEFAULT_ACCENT }}>
      <header className="card__head">
        <span className="card__name">{profile.name}</span>
        <Money usd={telemetry.totalCostUsd} fx={fx} className="card__cost" />
      </header>
      <StateBar
        state={telemetry.state}
        detail={telemetry.currentTool}
        since={telemetry.since}
        now={now}
        appearance={appearance}
      />
      <ContextBar pct={telemetry.contextPct} />
      <p className="card__prompt" title={telemetry.lastPrompt ?? ""}>
        {telemetry.lastPrompt ?? <em>No prompt yet</em>}
      </p>
      <div className="card__actions">
        <button type="button" onClick={() => bridge.focus(id)}>
          Focus
        </button>
        <button type="button" onClick={() => bridge.center(id)}>
          Center
        </button>
        <button type="button" onClick={() => bridge.bringHere(id)}>
          Bring Here
        </button>
      </div>
      <button type="button" className="card__terminate" onClick={() => bridge.terminate(id)}>
        Terminate
      </button>
    </article>
  );
}

// A session that is not running but can be brought back on the same
// conversation, in the same place. Dismiss removes it for good.
export function DormantCard({ entry, now, fx, appearance }) {
  const { bridge } = window.hekaton;
  const title = entry.title && entry.title !== entry.profileName ? entry.title : null;
  return (
    <article className="card card--dormant" style={{ "--accent": entry.accent ?? DEFAULT_ACCENT }}>
      <header className="card__head">
        <span className="card__name">
          {entry.profileName}
          {title && <span className="card__title"> · {title}</span>}
        </span>
        <Money usd={entry.totalCostUsd} fx={fx} className="card__cost" />
      </header>
      <StateBar state="saved" detail={entry.model} since={entry.lastSeenAt} now={now} appearance={appearance} />
      <p className="card__prompt" title={entry.lastPrompt ?? entry.firstPrompt ?? ""}>
        {entry.lastPrompt ?? entry.firstPrompt ?? <em>No prompt recorded</em>}
      </p>
      <div className="card__actions">
        <button
          type="button"
          className="button--primary"
          disabled={!entry.claudeSessionId}
          title={entry.claudeSessionId ? "Reopen this conversation where it was" : "No conversation id recorded"}
          onClick={() => bridge.resumeInstance(entry.id)}
        >
          Resume
        </button>
        <button type="button" className="button--danger" onClick={() => bridge.dismissInstance(entry.id)}>
          Dismiss
        </button>
      </div>
    </article>
  );
}

const EXTERNAL_STATES = { idle: "idle", busy: "running" };

// A Claude Code session running on this machine that Hekaton did not launch.
export function ExternalSessionCard({ session, now, appearance }) {
  const name = session.name ?? session.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? `pid ${session.pid}`;
  return (
    <article className="card card--external">
      <header className="card__head">
        <span className="card__name">{name}</span>
        <span className="card__cost">pid {session.pid}</span>
      </header>
      <StateBar
        state={EXTERNAL_STATES[session.status] ?? session.status ?? "idle"}
        since={session.statusSince}
        now={now}
        appearance={appearance}
      />
      <p className="card__prompt" title={session.cwd ?? ""}>
        {session.cwd}
      </p>
      <p className="card__note">Running outside Hekaton</p>
    </article>
  );
}
