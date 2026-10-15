// Display defaults for each session state. Labels and colours become
// user-editable in Settings; these are the shipped values.
export const STATUS_STATES = Object.freeze({
  launching: { label: "LAUNCHING", color: "#3b82f6" },
  idle: { label: "IDLE", color: "#22c55e" },
  running: { label: "THINKING", color: "#a855f7" },
  awaiting_approval: { label: "AWAITING APPROVAL", color: "#f59e0b" },
  compacting: { label: "COMPACTING", color: "#0ea5e9" },
  failed: { label: "FAILED", color: "#ef4444" },
  exited: { label: "EXITED", color: "#374151" },
});

export function statusAppearance(state) {
  return STATUS_STATES[state] ?? { label: state.toUpperCase(), color: "#6b7280" };
}
