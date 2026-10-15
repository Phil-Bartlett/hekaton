import { readableOn } from "./color.js";

// Display defaults for each session state. Settings can override the label
// and colour of any of them; the text colour follows whatever reads best.
export const STATUS_STATES = Object.freeze({
  launching: { label: "LAUNCHING", color: "#3b82f6" },
  idle: { label: "IDLE", color: "#22c55e" },
  running: { label: "THINKING", color: "#a855f7" },
  awaiting_approval: { label: "AWAITING APPROVAL", color: "#f59e0b" },
  compacting: { label: "COMPACTING", color: "#0ea5e9" },
  failed: { label: "FAILED", color: "#ef4444" },
  exited: { label: "EXITED", color: "#374151" },
  saved: { label: "SAVED", color: "#4b5563" },
});

export function statusAppearance(state, overrides = {}) {
  const base = STATUS_STATES[state] ?? { label: state.toUpperCase(), color: "#6b7280" };
  const custom = overrides[state] ?? {};
  const color = custom.color || base.color;
  return { label: custom.label || base.label, color, text: readableOn(color) };
}
