// node-pty's prebuilt spawn-helper is unpacked without its execute bit, so
// node-pty's posix_spawn of it fails with "posix_spawnp failed" and no session
// window opens on macOS or Linux. Restore +x, and ad-hoc re-sign it on macOS so
// Apple Silicon will exec the nested binary.
const { readdirSync, chmodSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");

function spawnHelpers(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...spawnHelpers(full));
    else if (entry.name === "spawn-helper") found.push(full);
  }
  return found;
}

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName;
  if (platform !== "darwin" && platform !== "linux") return;
  const app = context.packager.appInfo.productFilename;
  const resources =
    platform === "darwin"
      ? join(context.appOutDir, `${app}.app`, "Contents", "Resources")
      : join(context.appOutDir, "resources");
  const helpers = spawnHelpers(join(resources, "app.asar.unpacked", "node_modules", "node-pty"));
  for (const helper of helpers) {
    chmodSync(helper, 0o755);
    if (platform === "darwin") {
      execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", helper]);
    }
    console.log(`after-pack: restored spawn-helper execute bit: ${helper}`);
  }
};
