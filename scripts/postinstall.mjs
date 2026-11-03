// npm unpacks node-pty's prebuilt spawn-helper without its execute bit, so on
// macOS and Linux a dev checkout fails to open any session: node-pty's
// posix_spawn of the helper dies with "posix_spawnp failed". Restore +x here
// for `npm start`; scripts/after-pack.cjs does the same inside the packaged
// app, where this run's node_modules is not what ships.
import { chmodSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  const prebuilds = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    "node-pty",
    "prebuilds",
  );
  let dirs = [];
  try {
    dirs = readdirSync(prebuilds, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    // No prebuilds: node-pty was compiled from source and needs no helper fix.
  }
  for (const dir of dirs) {
    const helper = path.join(prebuilds, dir.name, "spawn-helper");
    try {
      chmodSync(helper, 0o755);
    } catch {
      // Windows prebuild folders carry no helper.
    }
  }
}
