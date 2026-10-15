import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import pty from "node-pty";
import { userStatusLineCommand } from "./claudeConfig.js";
import { claudeArgs, launchEnv, launchName, sessionSettings } from "./launch.js";
import { claudeBinary, resourcePath } from "./platform.js";
import { applyExit, applyHook, applyStatus, initialTelemetry } from "./state.js";
import { tailTranscript } from "./transcript.js";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const MAX_SCROLLBACK_CHARS = 200_000;

function publicView({
  term: _term,
  settingsPath: _settingsPath,
  stopTail: _stopTail,
  scrollback: _scrollback,
  scrollbackChars: _scrollbackChars,
  ...session
}) {
  return session;
}

// Owns every pty and its telemetry. `emit(event, instanceId, payload)` is the
// only way anything leaves; the window layer decides where it goes.
export function createSessionManager(emit, telemetryServer) {
  const sessions = new Map();
  // Nothing is running when the manager is created, so anything left in the
  // launch folder belongs to a previous run that did not get to clean up.
  const launchDir = path.join(app.getPath("userData"), "launch");
  rmSync(launchDir, { recursive: true, force: true });
  mkdirSync(launchDir, { recursive: true });

  // One --settings file per session, carrying the hook and statusline relays
  // with this session's URLs baked in. Removed again when the pty exits.
  function writeSettings(id) {
    const file = path.join(launchDir, `${id}.json`);
    const settings = sessionSettings({
      hookUrl: telemetryServer.hookUrl(id),
      statusUrl: telemetryServer.statusUrl(id),
      relayScript: resourcePath("scripts", "statusline-relay.sh"),
      userStatusLine: userStatusLineCommand(),
    });
    writeFileSync(file, JSON.stringify(settings, null, 2));
    return file;
  }

  // The transcript path arrives with the first hook or statusline post and
  // changes again on /clear, so the tail follows whatever path is current.
  function followTranscript(session, transcriptPath) {
    if (!transcriptPath || transcriptPath === session.transcriptPath) return;
    session.stopTail?.();
    session.transcriptPath = transcriptPath;
    session.stopTail = tailTranscript(transcriptPath, (turns) => {
      session.activity = turns;
      emit("activity", session.id, turns);
    });
  }

  function update(session, telemetry) {
    session.telemetry = telemetry;
    followTranscript(session, telemetry.transcriptPath);
    emit("update", session.id, publicView(session));
  }

  // `id` lets a resumed session keep the card identity it had before.
  function launch(profile, { binary, id: givenId, trayOpen } = {}) {
    const id = givenId ?? randomUUID();
    const sessionId = profile.resume ? profile.resume : randomUUID();
    const settingsPath = writeSettings(id);
    const args = claudeArgs({ ...profile, name: launchName(profile), sessionId, settingsPath });
    const term = pty.spawn(claudeBinary(binary), args, {
      name: "xterm-256color",
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: profile.cwd,
      env: launchEnv(process.env, {
        HEKATON_INSTANCE: id,
        TERM_PROGRAM: "hekaton",
        COLORTERM: "truecolor",
      }),
    });
    const session = {
      id,
      sessionId,
      profile,
      pid: term.pid,
      startedAt: Date.now(),
      exitCode: null,
      telemetry: initialTelemetry(),
      trayOpen: trayOpen ?? profile.openTray === true,
      activity: [],
      transcriptPath: null,
      settingsPath,
      stopTail: null,
      attached: false,
      scrollback: [],
      scrollbackChars: 0,
      term,
    };
    sessions.set(id, session);
    // Output is buffered until the window's terminal attaches, so nothing
    // Claude draws while the page is still loading is lost.
    term.onData((data) => {
      session.scrollback.push(data);
      session.scrollbackChars += data.length;
      while (session.scrollbackChars > MAX_SCROLLBACK_CHARS && session.scrollback.length > 1) {
        session.scrollbackChars -= session.scrollback.shift().length;
      }
      if (session.attached) emit("data", id, data);
    });
    term.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
      rmSync(settingsPath, { force: true });
      if (!sessions.has(id)) return;
      update(session, applyExit(session.telemetry, exitCode));
      emit("exit", id, exitCode);
    });
    return publicView(session);
  }

  // Forget a session: kills the pty if it is still running.
  function remove(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    session.stopTail?.();
    if (session.exitCode === null) session.term.kill();
  }

  function applyHookPayload(id, payload) {
    const session = sessions.get(id);
    if (!session) return false;
    update(session, applyHook(session.telemetry, payload));
    return true;
  }

  function applyStatusPayload(id, payload, meta) {
    const session = sessions.get(id);
    if (!session) return false;
    update(session, applyStatus(session.telemetry, payload, meta));
    return true;
  }

  function setTray(id, open) {
    const session = sessions.get(id);
    if (!session) return;
    session.trayOpen = open;
    emit("update", id, publicView(session));
  }

  // Re-label a running session under another profile. The Claude process
  // keeps its working directory until the conversation is next resumed.
  function setProfile(id, profile) {
    const session = sessions.get(id);
    if (!session) return;
    session.profile = { ...session.profile, ...profile };
    emit("update", id, publicView(session));
  }

  // Returns everything drawn so far and switches the session to live streaming.
  function attach(id) {
    const session = sessions.get(id);
    if (!session) return null;
    session.attached = true;
    return session.scrollback.join("");
  }

  function write(id, data) {
    sessions.get(id)?.term.write(data);
  }

  function resize(id, cols, rows) {
    if (cols > 0 && rows > 0) sessions.get(id)?.term.resize(cols, rows);
  }

  function kill(id) {
    sessions.get(id)?.term.kill();
  }

  function get(id) {
    const session = sessions.get(id);
    return session ? publicView(session) : null;
  }

  function list() {
    return [...sessions.values()].map(publicView);
  }

  function killAll() {
    for (const session of sessions.values()) session.term.kill();
  }

  return {
    launch,
    applyHook: applyHookPayload,
    applyStatus: applyStatusPayload,
    setTray,
    setProfile,
    attach,
    write,
    resize,
    kill,
    killAll,
    remove,
    get,
    list,
  };
}
