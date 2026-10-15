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
const PALETTE = ["#3b82f6", "#f97316", "#ec4899", "#22c55e", "#a855f7", "#14b8a6", "#eab308", "#ef4444"];

function randomAccent() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

export default function ProfileEditor({ profile, onClose }) {
  const [form, setForm] = useState({
    name: "",
    cwd: "",
    model: "",
    effort: "",
    permissionMode: "",
    accent: randomAccent(),
    colorScope: "border+title",
    ...profile,
  });
  const [error, setError] = useState(null);
  const { bridge } = window.hekaton;
  const isNew = !profile.id;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function browse() {
    const folder = await bridge.pickFolder();
    if (folder) setForm((current) => ({ ...current, cwd: folder }));
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

  return (
    <form className="editor" onSubmit={save}>
      <h1 className="editor__title">{isNew ? "New Profile" : `Edit ${profile.name}`}</h1>
      <div className="editor__grid">
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
        <label className="field">
          <span>Accent Colour</span>
          <span className="field__row">
            <input type="color" value={form.accent} onChange={set("accent")} aria-label="Accent colour" />
            <input value={form.accent} onChange={set("accent")} spellCheck={false} aria-label="Accent hex" />
            <button type="button" onClick={() => setForm((c) => ({ ...c, accent: randomAccent() }))}>
              Random
            </button>
          </span>
          <span className="segmented" role="radiogroup" aria-label="Colour applies to">
            {COLOR_SCOPES.map((scope) => (
              <button
                key={scope.value}
                type="button"
                role="radio"
                aria-checked={form.colorScope === scope.value}
                className={form.colorScope === scope.value ? "is-selected" : ""}
                onClick={() => setForm((c) => ({ ...c, colorScope: scope.value }))}
              >
                {scope.label}
              </button>
            ))}
          </span>
        </label>
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
