import { useEffect, useState } from "react";
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

// Artifacts and PRs the session has produced, newest last, opened in the
// browser. Shown only when the session has made some.
function CardLinks({ links }) {
  if (!links || links.length === 0) return null;
  const shown = links.slice(-3);
  return (
    <div className="card__links">
      {links.length > shown.length && <span className="card__links-more">+{links.length - shown.length}</span>}
      {shown.map((link) => (
        <button
          key={link.url}
          type="button"
          className={`card__link card__link--${link.kind}`}
          title={link.url}
          onClick={() => window.hekaton.link.open(link.url)}
        >
          {link.kind === "pr"
            ? (link.url.match(/\/(?:pull|merge_requests)\/(\d+)/)?.[1] ?? "PR").replace(/^/, "#")
            : "Artifact"}
        </button>
      ))}
    </div>
  );
}

export default function SessionCard({ session, now, fx, appearance, profiles, showNames, drag }) {
  const { id, profile, telemetry } = session;
  const { bridge } = window.hekaton;
  const [menuOpen, setMenuOpen] = useState(false);
  const { dragClass, handlers } = splitDrag(drag);
  return (
    <article className={`card${dragClass}`} style={{ "--accent": profile.accent ?? DEFAULT_ACCENT }} {...handlers}>
      <header className="card__head">
        <CardName
          profileName={profile.name}
          sessionName={telemetry.sessionName || session.activity?.title}
          showNames={showNames}
        />
        {telemetry.remoteControlId && (
          <span className="card__badge" title="Connected to Remote Control: the Claude app can drive this session">
            Remote
          </span>
        )}
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
      <CardLinks links={session.activity?.links} />
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

// Which machine a card belongs to, for cards that came through the shared data folder.
function HostBadge({ name, online }) {
  return (
    <span
      className={`card__badge card__badge--host${online ? "" : " card__badge--offline"}`}
      title={online ? `Running on ${name}` : `${name} is not running Hekaton right now`}
    >
      {name}
    </span>
  );
}

// A session running under another machine's Hekaton, drawn from its
// presence file. There is no window here, so nothing to focus or tile.
export function RemoteSessionCard({ host, session, now, fx, appearance, showNames, drag }) {
  const { dragClass, handlers } = splitDrag(drag);
  return (
    <article
      className={`card card--remote${dragClass}`}
      style={{ "--accent": session.accent ?? DEFAULT_ACCENT }}
      {...handlers}
    >
      <header className="card__head">
        <CardName profileName={session.profileName} sessionName={session.title} showNames={showNames} />
        <HostBadge name={host.name} online={host.online} />
        {session.remoteControlId && (
          <span className="card__badge" title="Connected to Remote Control: the Claude app can drive this session">
            Remote
          </span>
        )}
        <Money usd={session.totalCostUsd} fx={fx} className="card__cost" />
      </header>
      <StateBar
        state={session.state}
        detail={session.currentTool}
        since={session.since}
        now={now}
        appearance={appearance}
      />
      <ContextBar pct={session.contextPct} />
      <p className="card__prompt" title={session.lastPrompt ?? ""}>
        {session.lastPrompt ?? <em>No prompt yet</em>}
      </p>
      <CardLinks links={session.links} />
      <p className="card__note">Running on {host.name}</p>
    </article>
  );
}

// A session that is not running but can be brought back on the same
// conversation, in the same place. Dismiss removes it for good. A card from
// another machine can only be looked at: its transcript lives there.
export function DormantCard({ entry, now, fx, appearance, profiles, showNames, drag }) {
  const { bridge } = window.hekaton;
  const [menuOpen, setMenuOpen] = useState(false);
  const { dragClass, handlers } = splitDrag(drag);
  // Still alive somewhere else: resuming would start a second copy.
  const orphan = Boolean(entry.runningPid);
  const elsewhere = entry.foreignHost ?? null;
  const [ending, setEnding] = useState(false);
  useEffect(() => {
    if (!orphan) setEnding(false);
  }, [orphan]);
  return (
    <article
      className={`card card--dormant${dragClass}`}
      style={{ "--accent": entry.accent ?? DEFAULT_ACCENT }}
      {...handlers}
    >
      <header className="card__head">
        <CardName profileName={entry.profileName} sessionName={entry.title} showNames={showNames} />
        {entry.remote && <HostBadge name={entry.foreignHost} online={entry.hostOnline} />}
        <Money usd={entry.totalCostUsd} fx={fx} className="card__cost" />
        {!entry.remote && <MenuButton open={menuOpen} onToggle={() => setMenuOpen((open) => !open)} />}
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
      <StateBar
        state={orphan ? "orphan" : "saved"}
        detail={orphan ? `pid ${entry.runningPid}` : elsewhere ? `on ${elsewhere}` : entry.model}
        since={entry.lastSeenAt}
        now={now}
        appearance={appearance}
      />
      <p className="card__prompt" title={entry.lastPrompt ?? entry.firstPrompt ?? ""}>
        {entry.lastPrompt ?? entry.firstPrompt ?? <em>No prompt recorded</em>}
      </p>
      <div className="card__actions">
        {orphan ? (
          <button
            type="button"
            className="button--primary"
            disabled={ending}
            title="This conversation is still running outside Hekaton. Asks that copy to quit (types /exit for you) and closes the shell it ran in; then the card can be resumed here"
            onClick={async () => {
              setEnding(true);
              if (!(await bridge.endOrphan(entry.id))) setEnding(false);
            }}
          >
            {ending ? "Ending…" : "End outside copy"}
          </button>
        ) : (
          <button
            type="button"
            className="button--primary"
            disabled={!entry.claudeSessionId || Boolean(elsewhere)}
            title={
              elsewhere
                ? `Recorded on ${elsewhere}; its transcript lives there`
                : entry.claudeSessionId
                  ? "Reopen this conversation where it was"
                  : "No conversation id recorded"
            }
            onClick={() => bridge.resumeInstance(entry.id)}
          >
            Resume
          </button>
        )}
        {!entry.remote && (
          <button type="button" className="button--danger" onClick={() => bridge.dismissInstance(entry.id)}>
            Dismiss
          </button>
        )}
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
