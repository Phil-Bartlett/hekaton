import { useState } from "react";

const MODELS = [
  { value: "", label: "Claude Code default" },
  { value: "fable", label: "Fable (latest)" },
  { value: "opus", label: "Opus (latest)" },
  { value: "sonnet", label: "Sonnet (latest)" },
  { value: "haiku", label: "Haiku (latest)" },
];
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const PERMISSION_MODES = ["", "default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
const COLOR_SCOPES = [
  { value: "border", label: "Border Only" },
  { value: "border+title", label: "Border & Title" },
  { value: "title", label: "Title Only" },
];
const SIZE_PRESETS = [
  { value: "tiny", label: "Tiny", width: 800, height: 500 },
  { value: "small", label: "Small", width: 1000, height: 650 },
  { value: "medium", label: "Medium", width: 1280, height: 800 },
  { value: "large", label: "Large", width: 1600, height: 1000 },
  { value: "full", label: "Full" },
];
const POSITIONS = [
  ["nw", "↖"],
  ["n", "↑"],
  ["ne", "↗"],
  ["w", "←"],
  ["center", "·"],
  ["e", "→"],
  ["sw", "↙"],
  ["s", "↓"],
  ["se", "↘"],
];
const PALETTE = ["#3b82f6", "#f97316", "#ec4899", "#22c55e", "#a855f7", "#14b8a6", "#eab308", "#ef4444"];

function randomAccent() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function Segmented({ label, options, value, onChange }) {
  return (
    <span className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "is-selected" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

// A scaled sketch of the chosen display with the window where it will land.
function PlacementPreview({ size, position }) {
  const col = position.includes("w") && position !== "center" ? 0 : position.includes("e") ? 2 : 1;
  const row = position.includes("n") && position !== "center" ? 0 : position.includes("s") ? 2 : 1;
  const preset = SIZE_PRESETS.find((p) => p.value === size.preset);
  const width = size.preset === "full" ? 1920 : size.preset === "custom" ? size.width : preset.width;
  const height = size.preset === "full" ? 1040 : size.preset === "custom" ? size.height : preset.height;
  const w = Math.min(100, (width / 1920) * 100);
  const h = Math.min(100, (height / 1040) * 100);
  return (
    <div className="placement" aria-hidden="true">
      <div
        className="placement__window"
        style={{
          width: `${w}%`,
          height: `${h}%`,
          left: `${[0, (100 - w) / 2, 100 - w][col]}%`,
          top: `${[0, (100 - h) / 2, 100 - h][row]}%`,
        }}
      />
    </div>
  );
}

export default function ProfileEditor({ profile, displays, onClose }) {
  const [form, setForm] = useState({
    name: "",
    cwd: "",
    model: "",
    effort: "",
    permissionMode: "",
    accent: randomAccent(),
    colorScope: "border+title",
    monitor: "primary",
    size: { preset: "medium", width: 1280, height: 800 },
    position: "center",
    openTray: false,
    alwaysOnTop: false,
    confirmClose: false,
    skipPermissions: false,
    remoteControl: false,
    addDirs: [],
    ...profile,
  });
  const [error, setError] = useState(null);
  const { bridge } = window.hekaton;
  const isNew = !profile.id;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setFlag = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.checked }));
  const patch = (changes) => setForm((current) => ({ ...current, ...changes }));

  function setPreset(preset) {
    const row = SIZE_PRESETS.find((p) => p.value === preset);
    patch({ size: { preset, width: row.width ?? form.size.width, height: row.height ?? form.size.height } });
  }

  function setDimension(key) {
    return (event) => patch({ size: { ...form.size, preset: "custom", [key]: Number(event.target.value) || 0 } });
  }

  async function browse() {
    const folder = await bridge.pickFolder();
    if (folder) patch({ cwd: folder });
  }

  async function save(event) {
    event.preventDefault();
    try {
      await bridge.saveProfile(form);
      onClose();
    } catch (err) {
      setError(err.message.replace(/^.*Error: /, ""));
    }
  }

  async function remove() {
    await bridge.deleteProfile(profile.id);
    onClose();
  }

  const monitorOptions = displays.map((display) => ({
    value: display.primary ? "primary" : String(display.id),
    label: display.primary ? "Primary" : display.label,
  }));

  return (
    <form className="editor" onSubmit={save}>
      <h1 className="editor__title">{isNew ? "New Profile" : `Edit ${profile.name}`}</h1>
      <div className="editor__grid">
        <div className="editor__column">
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={set("name")} autoFocus required />
          </label>
          <label className="field">
            <span>Working Directory</span>
            <span className="field__row">
              <input value={form.cwd} onChange={set("cwd")} required spellCheck={false} />
              <button type="button" onClick={browse}>
                Browse…
              </button>
            </span>
          </label>
          <label className="field">
            <span>Extra directories Claude may read and edit</span>
            <textarea
              rows={2}
              value={(form.addDirs ?? []).join("\n")}
              onChange={(event) =>
                patch({
                  addDirs: event.target.value
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean),
                })
              }
              placeholder="One folder per line (--add-dir)"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Preferred Model</span>
            <select value={MODELS.some((m) => m.value === form.model) ? form.model : "custom"} onChange={set("model")}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
              <option value="custom">Custom model id…</option>
            </select>
            <input
              value={form.model}
              onChange={set("model")}
              placeholder="claude-opus-5-5"
              spellCheck={false}
              aria-label="Model id"
            />
          </label>
          <label className="field">
            <span>Effort</span>
            <select value={form.effort} onChange={set("effort")}>
              {EFFORTS.map((e) => (
                <option key={e} value={e}>
                  {e || "Claude Code default"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Permission Mode</span>
            <select value={form.permissionMode} onChange={set("permissionMode")}>
              {PERMISSION_MODES.map((m) => (
                <option key={m} value={m}>
                  {m || "Claude Code default"}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Accent Colour</span>
            <span className="field__row">
              <input type="color" value={form.accent} onChange={set("accent")} aria-label="Accent colour" />
              <input value={form.accent} onChange={set("accent")} spellCheck={false} aria-label="Accent hex" />
              <button type="button" onClick={() => patch({ accent: randomAccent() })}>
                Random
              </button>
            </span>
            <span className="field__hint">Colour applies to</span>
            <Segmented
              label="Colour applies to"
              options={COLOR_SCOPES}
              value={form.colorScope}
              onChange={(colorScope) => patch({ colorScope })}
            />
          </div>
          <div className="field field--flags">
            <label className="field__danger">
              <input type="checkbox" checked={form.skipPermissions} onChange={setFlag("skipPermissions")} /> Dangerously
              skip permissions (claude --dangerously-skip-permissions)
            </label>
            <label>
              <input type="checkbox" checked={form.openTray} onChange={setFlag("openTray")} /> Open activity tray by
              default
            </label>
            <label>
              <input type="checkbox" checked={form.alwaysOnTop} onChange={setFlag("alwaysOnTop")} /> Start always on top
            </label>
            <label>
              <input type="checkbox" checked={form.confirmClose} onChange={setFlag("confirmClose")} /> Confirm before
              closing
            </label>
            <label>
              <input type="checkbox" checked={form.remoteControl} onChange={setFlag("remoteControl")} /> Remote Control:
              drive this session from the Claude app on a phone (claude --remote-control)
            </label>
          </div>
        </div>
        <div className="editor__column">
          <div className="field">
            <span>Preferred Monitor</span>
            <Segmented
              label="Preferred monitor"
              options={monitorOptions}
              value={form.monitor}
              onChange={(monitor) => patch({ monitor })}
            />
          </div>
          <div className="field">
            <span>Preferred Size</span>
            <span className="field__row">
              <label className="field__dimension">
                <span>Width</span>
                <input type="number" min="480" value={form.size.width} onChange={setDimension("width")} />
              </label>
              <label className="field__dimension">
                <span>Height</span>
                <input type="number" min="240" value={form.size.height} onChange={setDimension("height")} />
              </label>
            </span>
            <Segmented label="Size preset" options={SIZE_PRESETS} value={form.size.preset} onChange={setPreset} />
          </div>
          <div className="field">
            <span>Position</span>
            <PlacementPreview size={form.size} position={form.position} />
            <span className="position-grid" role="radiogroup" aria-label="Position">
              {POSITIONS.map(([value, glyph]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={form.position === value}
                  aria-label={value}
                  className={form.position === value ? "is-selected" : ""}
                  onClick={() => patch({ position: value })}
                >
                  {glyph}
                </button>
              ))}
            </span>
          </div>
        </div>
      </div>
      {error && (
        <p className="editor__error" role="alert">
          {error}
        </p>
      )}
      <footer className="editor__footer">
        <button type="button" className="button--danger" onClick={onClose}>
          Cancel
        </button>
        {!isNew && (
          <button type="button" className="button--danger" onClick={remove}>
            Delete profile
          </button>
        )}
        <button type="submit" className="button--primary">
          Save
        </button>
      </footer>
    </form>
  );
}
