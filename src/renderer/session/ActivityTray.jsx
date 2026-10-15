import { useEffect, useRef } from "react";
import { formatClock, formatDuration, formatTokens } from "../shared/format.js";
import Money from "../shared/Money.jsx";

const TOOL_GLYPHS = { Write: "✎", Edit: "✎", Read: "▪", Bash: "▸", PowerShell: "▸", Grep: "⌕", Glob: "⌕" };

function ToolRow({ tool }) {
  return (
    <li className={`tool-row${tool.error ? " is-error" : ""}`} title={tool.summary}>
      <span className="tool-row__glyph" aria-hidden="true">
        {TOOL_GLYPHS[tool.name] ?? "•"}
      </span>
      <span className="tool-row__name">{tool.name}</span>
      <span className="tool-row__arrow">-&gt;</span>
      <span className="tool-row__summary">{tool.summary}</span>
      <span className="tool-row__duration">{formatDuration(tool.durationMs)}</span>
    </li>
  );
}

function Turn({ turn, fx }) {
  const { usage } = turn;
  return (
    <article className="turn">
      <div className="turn__time">({formatClock(turn.at)})</div>
      <div className="turn__card">
        <p className="turn__prompt">{turn.prompt}</p>
        {turn.tools.length > 0 && (
          <ul className="turn__tools">
            {turn.tools.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </ul>
        )}
        <div className="turn__tokens">
          +{formatTokens(usage.input)} in · +{formatTokens(usage.output)} out · +{formatTokens(usage.cacheWrite)} cache
          ▲ · +{formatTokens(usage.cacheRead)} cache ▼
        </div>
        <div className="turn__chips">
          <span className="chip chip--time">{formatDuration(turn.durationMs)}</span>
          <Money usd={turn.costUsd} fx={fx} className="chip chip--cost" />
        </div>
      </div>
    </article>
  );
}

// Per-prompt activity from the transcript: tool calls, tokens and cost.
export default function ActivityTray({ turns, fx }) {
  const listRef = useRef(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns]);

  return (
    <aside className="activity-tray" aria-label="Session activity">
      <div className="activity-tray__list" ref={listRef}>
        {turns.length === 0 && <p className="activity-tray__empty">No activity yet.</p>}
        {turns.map((turn) => (
          <Turn key={turn.at} turn={turn} fx={fx} />
        ))}
      </div>
    </aside>
  );
}
