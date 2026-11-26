import { STATES } from "./state.js";

// What a session is in the middle of, in the words a "still working" prompt
// uses; null when closing it loses nothing in flight. The conversation itself
// always survives as a saved card, but the turn under way does not.
export function busyReason(session) {
  if (session.exitCode !== null) return null;
  const { state, currentTool } = session.telemetry;
  if (state === STATES.running) return currentTool ? `running ${currentTool}` : "thinking";
  if (state === STATES.awaitingApproval) return "waiting for an approval";
  if (state === STATES.compacting) return "compacting its conversation";
  return null;
}

export function sessionLabel(session) {
  const name = session.telemetry.sessionName;
  return name && name !== session.profile.name ? `${session.profile.name} · ${name}` : session.profile.name;
}

export const CLOSE_CHOICES = Object.freeze({ keep: 0, whenFinished: 1, now: 2 });

// The question asked when one working session's window is closed.
export function closePrompt(session) {
  const label = sessionLabel(session);
  return {
    type: "warning",
    buttons: ["Keep open", "Close when finished", "Close now"],
    defaultId: CLOSE_CHOICES.keep,
    cancelId: CLOSE_CHOICES.keep,
    message: `${label} is still ${busyReason(session)}.`,
    detail:
      "Closing now ends the turn in progress. The conversation is kept as a saved card either way, and can be resumed.",
  };
}

// The question asked when Hekaton is quit with sessions still working.
export function quitPrompt(busy) {
  const lines = busy.map((session) => `${sessionLabel(session)} is ${busyReason(session)}`);
  return {
    type: "warning",
    buttons: ["Cancel", "Quit when finished", "Quit now"],
    defaultId: CLOSE_CHOICES.keep,
    cancelId: CLOSE_CHOICES.keep,
    message: busy.length === 1 ? "A session is still working." : `${busy.length} sessions are still working.`,
    detail: `${lines.join("\n")}\n\nQuitting now ends the turns in progress. Every conversation is kept as a saved card and can be resumed.`,
  };
}
