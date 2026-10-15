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
          {turn.unpriced ? (
            <span className="chip chip--cost" title="This model is not in the price table yet">
              n/a
            </span>
          ) : (
            <Money usd={turn.costUsd} fx={fx} className="chip chip--cost" />
          )}
        </div>
      </div>
    </article>
  );
}

// Per-prompt activity from the transcript: tool calls, tokens and cost.
// `activity` carries the visible turns and a whole-session estimate;
// `reportedCostUsd` is Claude's own figure from the title bar, shown beside
// the estimate so the two numbers are not mistaken for the same measurement.
export default function ActivityTray({ activity, reportedCostUsd, fx }) {
  const listRef = useRef(null);
  const { turns, totalCostUsd, unpriced, droppedTurns } = activity;

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
      <footer className="activity-tray__totals">
        <span className="activity-tray__total">
          <span
            className="activity-tray__total-label"
            title="Hekaton's estimate from the price table, over the whole session"
          >
            Estimated{droppedTurns > 0 ? " (full session)" : ""}
          </span>
          {unpriced ? (
            <span className="activity-tray__total-value">n/a</span>
          ) : (
            <Money usd={totalCostUsd} fx={fx} className="activity-tray__total-value" />
          )}
        </span>
        <span className="activity-tray__total">
          <span
            className="activity-tray__total-label"
            title="Claude's own reported cost for this session, shown in the title bar"
          >
            Claude reports
          </span>
          <Money usd={reportedCostUsd} fx={fx} className="activity-tray__total-value" />
        </span>
      </footer>
    </aside>
  );
}
