import { useState } from "react";
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

// Profile name with Claude's own name for the conversation beneath it.
function CardName({ profileName, sessionName, showNames }) {
  const subtitle = showNames && sessionName && sessionName !== profileName ? sessionName : null;
  return (
    <span className="card__name" title={subtitle ?? profileName}>
      {profileName}
      {subtitle && <span className="card__subtitle">{subtitle}</span>}
    </span>
  );
}

function MenuButton({ open, onToggle }) {
  return (
    <button type="button" className="card__menu-button" aria-label="Card menu" aria-expanded={open} onClick={onToggle}>
      ⋯
    </button>
  );
}

// Move this card (and its conversation) under another profile.
function MovePicker({ profiles, currentProfileId, onMove }) {
  return (
    <label className="card__menu">
      Move to
      <select
        value=""
        onChange={(event) => {
          if (event.target.value) onMove(event.target.value);
        }}
      >
        <option value="">choose a profile…</option>
        {profiles
          .filter((profile) => profile.id !== currentProfileId)
          .map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
      </select>
    </label>
  );
}

// Drag handlers come from the Bridge with a class for the drag state; both
// land on the card element itself so the grid sizes the card as before.
function splitDrag(drag) {
  const { className = "", ...handlers } = drag ?? {};
  return { dragClass: className, handlers };
}

export default function SessionCard({ session, now, fx, appearance, profiles, showNames, drag }) {
  const { id, profile, telemetry } = session;
  const { bridge } = window.hekaton;
  const [menuOpen, setMenuOpen] = useState(false);
  const { dragClass, handlers } = splitDrag(drag);
  return (
    <article className={`card${dragClass}`} style={{ "--accent": profile.accent ?? DEFAULT_ACCENT }} {...handlers}>
      <header className="card__head">
        <CardName profileName={profile.name} sessionName={telemetry.sessionName} showNames={showNames} />
        <Money usd={telemetry.totalCostUsd} fx={fx} className="card__cost" />
        <MenuButton open={menuOpen} onToggle={() => setMenuOpen((open) => !open)} />
      </header>
      {menuOpen && (
        <MovePicker
          profiles={profiles}
          currentProfileId={profile.id}
          onMove={(profileId) => {
            setMenuOpen(false);
            bridge.moveInstance(id, profileId);
          }}
        />
      )}
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
export function DormantCard({ entry, now, fx, appearance, profiles, showNames, drag }) {
  const { bridge } = window.hekaton;
  const [menuOpen, setMenuOpen] = useState(false);
  const { dragClass, handlers } = splitDrag(drag);
  return (
    <article
      className={`card card--dormant${dragClass}`}
      style={{ "--accent": entry.accent ?? DEFAULT_ACCENT }}
      {...handlers}
    >
      <header className="card__head">
        <CardName profileName={entry.profileName} sessionName={entry.title} showNames={showNames} />
        <Money usd={entry.totalCostUsd} fx={fx} className="card__cost" />
        <MenuButton open={menuOpen} onToggle={() => setMenuOpen((open) => !open)} />
      </header>
      {menuOpen && (
        <MovePicker
          profiles={profiles}
          currentProfileId={entry.profileId}
          onMove={(profileId) => {
            setMenuOpen(false);
            bridge.moveInstance(entry.id, profileId);
          }}
        />
      )}
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
