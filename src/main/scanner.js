import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { claudeHome } from "./claudeConfig.js";

const PREVIEW_CHARS = 600;

// Just enough YAML for Claude Code frontmatter: `key: value` pairs, quoted
// values, inline lists left as text, `- item` and indented continuations
// folded onto the previous key.
export function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const block = text.slice(text.indexOf("\n") + 1, end);
  const body = text
    .slice(end + 4)
    .replace(/^[^\n]*\n?/, "")
    .trimStart();
  const data = {};
  let lastKey = null;
  for (const raw of block.split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw);
    if (pair) {
      lastKey = pair[1];
      data[lastKey] = pair[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    } else if (lastKey && /^\s+-\s*/.test(raw)) {
      const item = raw.replace(/^\s+-\s*/, "").trim();
      data[lastKey] = data[lastKey] ? `${data[lastKey]}, ${item}` : item;
    } else if (lastKey && /^\s+\S/.test(raw)) {
      data[lastKey] = `${data[lastKey]} ${raw.trim()}`.trim();
    }
  }
  return { data, body };
}

function readEntry(kind, file, source) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(text);
  const fallbackName = kind === "skill" ? path.basename(path.dirname(file)) : path.basename(file, ".md");
  const name = data.name || fallbackName;
  return {
    kind,
    name,
    description: data.description ?? "",
    model: data.model ?? null,
    tools: data.tools ?? data["allowed-tools"] ?? null,
    userInvocable: data["user-invocable"] !== "false",
    modelInvocable: data["disable-model-invocation"] !== "true",
    argumentHint: data["argument-hint"] ?? null,
    invocation: kind === "agent" ? null : `/${name}`,
    file,
    source,
    preview: body.slice(0, PREVIEW_CHARS),
  };
}

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isDir(file) {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

// Scans one `.claude`-shaped root: skills/<name>/SKILL.md, agents/*.md and
// commands/**.md (commands may nest one level, which prefixes the name).
function scanRoot(root, source, into) {
  for (const entry of listDir(path.join(root, "skills"))) {
    const file = path.join(root, "skills", entry.name, "SKILL.md");
    if (entry.isDirectory() && existsSync(file)) into.push(readEntry("skill", file, source));
  }
  for (const entry of listDir(path.join(root, "agents"))) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      into.push(readEntry("agent", path.join(root, "agents", entry.name), source));
    }
  }
  const commands = path.join(root, "commands");
  for (const entry of listDir(commands)) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      into.push(readEntry("command", path.join(commands, entry.name), source));
    } else if (entry.isDirectory()) {
      for (const nested of listDir(path.join(commands, entry.name))) {
        if (nested.isFile() && nested.name.endsWith(".md")) {
          const item = readEntry("command", path.join(commands, entry.name, nested.name), source);
          if (item)
            into.push({ ...item, name: `${entry.name}:${item.name}`, invocation: `/${entry.name}:${item.name}` });
        }
      }
    }
  }
}

function scanPlugins(home, into) {
  const cache = path.join(home, "plugins", "cache");
  for (const marketplace of listDir(cache)) {
    if (!marketplace.isDirectory()) continue;
    for (const plugin of listDir(path.join(cache, marketplace.name))) {
      if (!plugin.isDirectory()) continue;
      const pluginDir = path.join(cache, marketplace.name, plugin.name);
      const versions = listDir(pluginDir).filter((v) => v.isDirectory());
      for (const version of versions) {
        scanRoot(path.join(pluginDir, version.name), `Plugin ${plugin.name}`, into);
      }
    }
  }
}

// `projectDirs` are the working directories of the launch profiles; `customRoots`
// are folders the user added, scanned both as-is and as `<root>/.claude`.
export function scanReference({ projectDirs = [], customRoots = [], home = claudeHome() } = {}) {
  const found = [];
  scanRoot(home, "User", found);
  for (const dir of new Set(projectDirs)) {
    if (isDir(path.join(dir, ".claude"))) scanRoot(path.join(dir, ".claude"), `Project ${path.basename(dir)}`, found);
  }
  scanPlugins(home, found);
  for (const root of customRoots) {
    scanRoot(root, `Custom ${path.basename(root)}`, found);
    if (isDir(path.join(root, ".claude"))) scanRoot(path.join(root, ".claude"), `Custom ${path.basename(root)}`, found);
  }
  const seen = new Set();
  return found
    .filter((entry) => entry && !seen.has(entry.file) && seen.add(entry.file))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
