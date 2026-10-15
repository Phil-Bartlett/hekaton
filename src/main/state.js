// Pure session telemetry reducer. Hooks drive the state, the statusline
// drives cost / context / model, and the pty exit code closes it out. Every
// function returns a new object so callers can diff and tests stay simple.

export const STATES = Object.freeze({
  launching: "launching",
  idle: "idle",
  running: "running",
  awaitingApproval: "awaiting_approval",
  compacting: "compacting",
  failed: "failed",
  exited: "exited",
});

export function initialTelemetry(at = Date.now()) {
  return {
    state: STATES.launching,
    since: at,
    stateBeforeCompact: null,
    currentTool: null,
    firstPrompt: null,
    lastPrompt: null,
    claudeSessionId: null,
    sessionName: null,
    transcriptPath: null,
    model: null,
    costUsd: 0,
    bankedCostUsd: 0,
    totalCostUsd: 0,
    contextPct: null,
    rateLimits: null,
  };
}

function transition(telemetry, state, at, patch = {}) {
  const since = state === telemetry.state ? telemetry.since : at;
  return { ...telemetry, ...patch, state, since };
}

// Claude Code only fires Notification hooks when the user looks away, so
// PermissionRequest is the signal for "waiting on an approval".
export function applyHook(telemetry, payload, at = Date.now()) {
  const identity = {
    claudeSessionId: payload.session_id ?? telemetry.claudeSessionId,
    transcriptPath: payload.transcript_path ?? telemetry.transcriptPath,
  };
  switch (payload.hook_event_name) {
    case "SessionStart":
      return transition(telemetry, STATES.idle, at, identity);
    case "UserPromptSubmit":
      return transition(telemetry, STATES.running, at, {
        ...identity,
        firstPrompt: telemetry.firstPrompt ?? payload.prompt ?? null,
        lastPrompt: payload.prompt ?? null,
      });
    case "PreToolUse":
      return transition(telemetry, STATES.running, at, { ...identity, currentTool: payload.tool_name ?? null });
    case "PostToolUse":
      return transition(telemetry, STATES.running, at, { ...identity, currentTool: null });
    case "PermissionRequest":
      return transition(telemetry, STATES.awaitingApproval, at, {
        ...identity,
        currentTool: payload.tool_name ?? null,
      });
    case "Stop":
      return transition(telemetry, STATES.idle, at, { ...identity, currentTool: null });
    case "StopFailure":
      return transition(telemetry, STATES.failed, at, { ...identity, currentTool: null });
    case "PreCompact":
      return transition(telemetry, STATES.compacting, at, { ...identity, stateBeforeCompact: telemetry.state });
    case "PostCompact":
      return transition(telemetry, telemetry.stateBeforeCompact ?? STATES.idle, at, {
        ...identity,
        stateBeforeCompact: null,
      });
    case "SessionEnd":
      return transition(telemetry, STATES.exited, at, { ...identity, currentTool: null });
    default:
      return { ...telemetry, ...identity };
  }
}

// cost.total_cost_usd resets whenever /clear starts a new session id, so the
// running total banks the previous id's figure before switching.
export function applyStatus(telemetry, payload) {
  const sessionId = payload.session_id ?? telemetry.claudeSessionId;
  const switched = telemetry.claudeSessionId && sessionId !== telemetry.claudeSessionId;
  const bankedCostUsd = switched ? telemetry.bankedCostUsd + telemetry.costUsd : telemetry.bankedCostUsd;
  const costUsd = payload.cost?.total_cost_usd ?? (switched ? 0 : telemetry.costUsd);
  return {
    ...telemetry,
    claudeSessionId: sessionId,
    sessionName: payload.session_name ?? telemetry.sessionName,
    transcriptPath: payload.transcript_path ?? telemetry.transcriptPath,
    model: payload.model ? { id: payload.model.id, name: payload.model.display_name } : telemetry.model,
    costUsd,
    bankedCostUsd,
    totalCostUsd: bankedCostUsd + costUsd,
    contextPct: payload.context_window?.used_percentage ?? telemetry.contextPct,
    rateLimits: payload.rate_limits ?? telemetry.rateLimits,
  };
}

// The two transitions worth interrupting someone for: Claude stopped to ask
// for a permission, or a turn finished. Anything else is noise.
export function attentionFor(previous, next) {
  if (previous === next) return null;
  if (next === STATES.awaitingApproval) return "approval";
  if (next === STATES.idle && (previous === STATES.running || previous === STATES.compacting)) return "finished";
  return null;
}

export function applyExit(telemetry, exitCode, at = Date.now()) {
  return transition(telemetry, exitCode === 0 ? STATES.exited : STATES.failed, at, { currentTool: null });
}
