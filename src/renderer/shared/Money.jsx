import { formatGbp, moneyTitle } from "./format.js";

// A pound figure with the underlying dollar amount on hover.
export default function Money({ usd, fx, className }) {
  return (
    <span className={className} title={moneyTitle(usd, fx)}>
      {formatGbp(usd, fx)}
    </span>
  );
}
