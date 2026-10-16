import { formatAge } from "../shared/format.js";
import Money from "../shared/Money.jsx";

const THRESHOLDS = { session: [70, 90], weekly: [60, 80] };

function tone(pct, [amber, red]) {
  if (pct >= red) return "is-red";
  if (pct >= amber) return "is-amber";
  return "";
}

function resetsAt(epochSeconds) {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function LimitBar({ label, limit, thresholds }) {
  const pct = Math.round(limit?.used_percentage ?? 0);
  const reset = resetsAt(limit?.resets_at);
  return (
    <div className={`usage__limit ${tone(pct, thresholds)}`}>
      <span className="usage__label">
        {label}: <strong>{pct}%</strong>
        {reset && <span className="usage__reset"> resets {reset}</span>}
      </span>
      <div className="usage__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="usage__fill" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function tokensShort(n) {
  if (n === null || n === undefined) return null;
  for (const [unit, size] of [
    ["B", 1e9],
    ["M", 1e6],
    ["K", 1e3],
  ]) {
    if (n >= size) return `${(n / size).toFixed(2)}${unit}`;
  }
  return String(n);
}

// Account quota (5-hour and 7-day windows) and the rolling 31-day spend.
export default function UsagePanel({ usage, fx, now }) {
  const { rateLimits, at, rolling } = usage;
  return (
    <div className="usage" aria-label="Usage">
      {rateLimits ? (
        <>
          <LimitBar label="Session" limit={rateLimits.five_hour} thresholds={THRESHOLDS.session} />
          <LimitBar label="Weekly" limit={rateLimits.seven_day} thresholds={THRESHOLDS.weekly} />
          <span className="usage__updated">Updated {formatAge(now - at)} ago</span>
        </>
      ) : (
        <span className="usage__empty">Quota appears once a session reports.</span>
      )}
      {rolling && (
        <span className="usage__rolling" title="API-equivalent list-price cost of the last 31 days on this PC">
          31d <Money usd={rolling.costUsd} fx={fx} />
          {rolling.tokens !== null && <span> · {tokensShort(rolling.tokens)} tokens</span>}
        </span>
      )}
    </div>
  );
}
