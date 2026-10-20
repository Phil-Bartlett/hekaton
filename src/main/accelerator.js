// Electron accelerators ("Control+Alt+H") taken apart for a Linux
// compositor to bind: generic modifier names and an xkb keysym. Each
// compositor spells the result its own way.

const MODIFIERS = {
  control: "ctrl",
  ctrl: "ctrl",
  commandorcontrol: "ctrl",
  cmdorctrl: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  super: "super",
  meta: "super",
  command: "super",
  cmd: "super",
};

// Electron's names for keys that are not a single character.
const NAMED_KEYS = {
  space: "space",
  enter: "Return",
  return: "Return",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "BackSpace",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageup: "Prior",
  pagedown: "Next",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
};

// { modifiers, key, character }, where `character` says the key is a letter
// or digit whose case the compositor decides; null when any part has no
// keysym.
export function parseAccelerator(accelerator) {
  const parts = String(accelerator ?? "")
    .split("+")
    .map((part) => part.trim());
  const key = parts.pop();
  const modifiers = parts.map((part) => MODIFIERS[part.toLowerCase()]);
  if (modifiers.some((modifier) => !modifier)) return null;
  const character = /^[a-z0-9]$/i.test(key);
  const name = character || /^f([1-9]|1[0-9]|2[0-4])$/i.test(key) ? key.toUpperCase() : NAMED_KEYS[key.toLowerCase()];
  return name ? { modifiers: [...new Set(modifiers)], key: name, character } : null;
}
