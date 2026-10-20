import { useEffect, useRef, useState } from "react";
import { updateStatusText } from "./UpdateBadge.jsx";
import { STATUS_STATES } from "../shared/statusStates.js";
import { THEMES, applyTheme, resolveTheme, themeIssues } from "../shared/themes.js";

const TABS = [
  ["general", "General"],
  ["terminal", "Terminal"],
  ["status", "Status Appearance"],
  ["paths", "Paths & Storage"],
  ["theme", "Theme"],
];

const STATE_NAMES = {
  launching: "Launching",
  idle: "Idle",
  running: "Processing",
  awaiting_approval: "Approval pending",
  compacting: "Compacting",
  failed: "Failed",
  exited: "Exited",
};

const EMPTY_THEME = {
  label: "New theme",
  bg: "#1a1a1a",
  bgElevated: "#242424",
  fg: "#d4d4d4",
  fgMuted: "#8a8a8a",
  accent: "#22c55e",
};

function Swatches({ theme }) {
  return (
    <span className="swatches" aria-hidden="true">
      {[theme.bg, theme.bgElevated, theme.accent, theme.fg].map((color, index) => (
        <span key={index} className="swatch" style={{ background: color }} />
      ))}
    </span>
  );
}

// The switch is saved with the rest of Settings; Check now acts at once.
function UpdatesField({ draft, patch, update }) {
  return (
    <div className="field">
      <span>Updates</span>
      <span className="field--flags">
        <label>
          <input
            type="checkbox"
            checked={draft.autoUpdate !== false}
            onChange={(event) => patch({ autoUpdate: event.target.checked })}
          />{" "}
          Check for updates automatically and download them in the background
        </label>
      </span>
      <span className="field__row field__row--centred">
        <span className="field__hint" role="status">
          Version {update.current}. {updateStatusText(update)}
        </span>
        <button
          type="button"
          disabled={update.mode === "off" || update.status === "checking"}
          onClick={() => window.hekaton.bridge.checkForUpdates()}
        >
          Check now
        </button>
      </span>
    </div>
  );
}

function GeneralTab({ draft, patch, hotkeyError, update }) {
  const { tiling } = draft;
  return (
    <>
      <label className="field">
        <span>Global hotkey to raise the Bridge</span>
        <input
          value={draft.hotkey}
          onChange={(event) => patch({ hotkey: event.target.value })}
          placeholder="e.g. CommandOrControl+Shift+H"
          spellCheck={false}
        />
        <span className="field__hint">Electron accelerator syntax. Leave empty for none.</span>
        {hotkeyError && (
          <span className="editor__error" role="alert">
            That hotkey could not be registered; it may be taken by another app.
          </span>
        )}
        <span className="field--flags">
          <label>
            <input
              type="checkbox"
              checked={draft.showSessionNames !== false}
              onChange={(event) => patch({ showSessionNames: event.target.checked })}
            />{" "}
            Show Claude&apos;s own session name on cards and title bars
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.notifyApproval !== false}
              onChange={(event) => patch({ notifyApproval: event.target.checked })}
            />{" "}
            Notify when a session is waiting for an approval
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.notifyFinished !== false}
              onChange={(event) => patch({ notifyFinished: event.target.checked })}
            />{" "}
            Notify when a session finishes a turn
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.keepInTray !== false}
              onChange={(event) => patch({ keepInTray: event.target.checked })}
            />{" "}
            Keep running in the tray when every window is closed
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.launchAtLogin === true}
              onChange={(event) => patch({ launchAtLogin: event.target.checked })}
            />{" "}
            Start Hekaton when I sign in (hidden in the tray)
          </label>
        </span>
      </label>
      <label className="field">
        <span>Gap between tiled windows (px)</span>
        <input
          type="number"
          min={0}
          max={64}
          value={tiling.gap}
          onChange={(event) =>
            patch({ tiling: { ...tiling, gap: Math.min(Math.max(Number(event.target.value) || 0, 0), 64) } })
          }
        />
        <span className="field__hint">Space left between windows, and around them, when the Bridge tiles them.</span>
      </label>
      {update && <UpdatesField draft={draft} patch={patch} update={update} />}
    </>
  );
}

function TerminalTab({ draft, patch }) {
  const terminal = draft.terminal;
  return (
    <>
      <label className="field">
        <span>Font family</span>
        <input
          value={terminal.fontFamily}
          onChange={(event) => patch({ terminal: { ...terminal, fontFamily: event.target.value } })}
          placeholder="Cascadia Mono, Consolas, Menlo, monospace"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>Font size</span>
        <input
          type="number"
          min="9"
          max="28"
          value={terminal.fontSize}
          onChange={(event) => patch({ terminal: { ...terminal, fontSize: Number(event.target.value) || 14 } })}
        />
      </label>
    </>
  );
}

function StatusTab({ draft, patch }) {
  const overrides = draft.statusAppearance ?? {};
  const update = (state, changes) =>
    patch({ statusAppearance: { ...overrides, [state]: { ...overrides[state], ...changes } } });
  return (
    <div className="status-table">
      <p className="field__hint">Customise the display label and pill colour for each instance state.</p>
      <div className="status-table__row status-table__row--head">
        <span>State</span>
        <span>Display label</span>
        <span>Hex colour</span>
        <span />
      </div>
      {Object.entries(STATUS_STATES).map(([state, base]) => {
        const label = overrides[state]?.label ?? base.label;
        const color = overrides[state]?.color ?? base.color;
        return (
          <div key={state} className="status-table__row">
            <span>{STATE_NAMES[state]}</span>
            <input value={label} onChange={(event) => update(state, { label: event.target.value })} />
            <input
              value={color}
              onChange={(event) => update(state, { color: event.target.value })}
              spellCheck={false}
            />
            <input
              type="color"
              value={color}
              onChange={(event) => update(state, { color: event.target.value })}
              aria-label={`${STATE_NAMES[state]} colour`}
            />
          </div>
        );
      })}
    </div>
  );
}

function PathsTab({ draft, patch, dataFolder }) {
  const { bridge } = window.hekaton;
  async function changeDataFolder() {
    const folder = await bridge.pickFolder();
    if (folder) bridge.setDataFolder(folder);
  }
  async function browseBinary() {
    const file = await bridge.pickFile();
    if (file) patch({ claudeBinary: file });
  }
  async function addRoot() {
    const folder = await bridge.pickFolder();
    if (folder) patch({ referenceRoots: [...new Set([...draft.referenceRoots, folder])] });
  }
  return (
    <>
      <label className="field">
        <span>Claude Code executable</span>
        <span className="field__row">
          <input
            value={draft.claudeBinary}
            onChange={(event) => patch({ claudeBinary: event.target.value })}
            placeholder="Auto-detect (~/.local/bin or PATH)"
            spellCheck={false}
          />
          <button type="button" onClick={browseBinary}>
            Browse…
          </button>
        </span>
      </label>
      <div className="field">
        <span>Data folder (profiles, settings, cards, history)</span>
        <span className="field__row">
          <input value={dataFolder?.path ?? ""} readOnly />
          <button type="button" onClick={changeDataFolder}>
            Change…
          </button>
          {dataFolder && !dataFolder.isDefault && (
            <button type="button" onClick={() => bridge.setDataFolder(null)}>
              Use default
            </button>
          )}
        </span>
        <span className="field__hint">
          Point this at a OneDrive or Syncthing folder to carry profiles, settings, cards and history between machines.
          Hekaton restarts to switch. A card recorded on another machine shows its name and resumes only there.
        </span>
      </div>
      <div className="field">
        <span>Extra folders to scan for skills, agents and commands</span>
        {draft.referenceRoots.length === 0 && <span className="field__hint">None added.</span>}
        {draft.referenceRoots.map((root) => (
          <span key={root} className="field__row">
            <input value={root} readOnly />
            <button
              type="button"
              onClick={() => patch({ referenceRoots: draft.referenceRoots.filter((r) => r !== root) })}
            >
              Remove
            </button>
          </span>
        ))}
        <span className="field__row">
          <button type="button" onClick={addRoot}>
            + Add folder
          </button>
          <button type="button" onClick={() => bridge.openDataFolder()}>
            Open data folder
          </button>
        </span>
      </div>
    </>
  );
}

function ThemeTab({ draft, patch }) {
  const [editing, setEditing] = useState(null);
  const custom = draft.customThemes ?? {};
  const choose = (name) => patch({ theme: name });
  function saveCustom() {
    const key =
      editing.key ||
      editing.label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
    if (!key) return;
    patch({ customThemes: { ...custom, [key]: { ...editing, key: undefined } }, theme: key });
    setEditing(null);
  }
  const row = (name, theme, editable) => (
    <div key={name} className={`theme-row${draft.theme === name ? " is-selected" : ""}`}>
      <button
        type="button"
        className="theme-row__pick"
        onClick={() => choose(name)}
        aria-pressed={draft.theme === name}
      >
        {theme.label}
      </button>
      <Swatches theme={theme} />
      {editable && (
        <button
          type="button"
          className="theme-row__edit"
          aria-label={`Edit ${theme.label}`}
          onClick={() => setEditing({ key: name, ...theme })}
        >
          ✎
        </button>
      )}
    </div>
  );
  return (
    <>
      <span className="field__hint">Built-in</span>
      {Object.entries(THEMES).map(([name, theme]) => row(name, theme, false))}
      <span className="field__hint">Custom</span>
      {Object.entries(custom).map(([name, theme]) => row(name, theme, true))}
      {!editing && (
        <button type="button" onClick={() => setEditing({ key: "", ...EMPTY_THEME })}>
          + New theme
        </button>
      )}
      {editing && (
        <div className="theme-editor">
          <label className="field">
            <span>Name</span>
            <input value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} />
          </label>
          {[
            ["bg", "Background"],
            ["bgElevated", "Panels"],
            ["fg", "Text"],
            ["fgMuted", "Muted text"],
            ["accent", "Accent"],
          ].map(([key, label]) => (
            <label key={key} className="field field--inline">
              <span>{label}</span>
              <input
                type="color"
                value={editing[key]}
                onChange={(event) => setEditing({ ...editing, [key]: event.target.value })}
              />
              <input
                value={editing[key]}
                onChange={(event) => setEditing({ ...editing, [key]: event.target.value })}
                spellCheck={false}
              />
            </label>
          ))}
          {themeIssues(editing).map((issue) => (
            <span key={issue} className="editor__error" role="alert">
              {issue}
            </span>
          ))}
          <span className="field__row">
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button--primary"
              onClick={saveCustom}
              disabled={themeIssues(editing).length > 0}
              title={themeIssues(editing).length > 0 ? "Fix the contrast problems first" : "Save this theme"}
            >
              Save theme
            </button>
          </span>
        </div>
      )}
    </>
  );
}

export default function SettingsView({ settings, dataFolder, update, onClose }) {
  const [tab, setTab] = useState("general");
  const [draft, setDraft] = useState(settings);
  const [hotkeyError, setHotkeyError] = useState(false);
  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));

  // The Bridge previews the theme being chosen; leaving without saving puts
  // the saved one back. Session windows change only on Save.
  const keepRef = useRef(settings);
  keepRef.current = settings;
  useEffect(() => {
    applyTheme(resolveTheme(draft.theme, draft.customThemes));
  }, [draft.theme, draft.customThemes]);
  useEffect(() => () => applyTheme(resolveTheme(keepRef.current.theme, keepRef.current.customThemes)), []);

  async function save() {
    const result = await window.hekaton.bridge.saveSettings(draft);
    if (result?.hotkeyOk === false) {
      setHotkeyError(true);
      return;
    }
    keepRef.current = draft;
    onClose();
  }

  const body = {
    general: <GeneralTab draft={draft} patch={patch} hotkeyError={hotkeyError} update={update} />,
    terminal: <TerminalTab draft={draft} patch={patch} />,
    status: <StatusTab draft={draft} patch={patch} />,
    paths: <PathsTab draft={draft} patch={patch} dataFolder={dataFolder} />,
    theme: <ThemeTab draft={draft} patch={patch} />,
  }[tab];

  return (
    <div className="editor settings">
      <nav className="tabs" aria-label="Settings sections">
        <span className="editor__title settings__title">Settings</span>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`tabs__tab${tab === key ? " is-active" : ""}`}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="settings__body">{body}</div>
      <footer className="editor__footer">
        <button type="button" className="button--danger" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="button--primary" onClick={save}>
          Save
        </button>
      </footer>
    </div>
  );
}
