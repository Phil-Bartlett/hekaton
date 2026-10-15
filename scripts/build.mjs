// Bundles the three Electron tiers with esbuild. Sources are ESM; main and
// preload are emitted as CJS because a sandboxed preload must be CJS and the
// package is "type": "module", so the outputs take the .cjs extension to be
// read as CommonJS at all. Renderers are IIFE bundles loaded by a plain
// <script> tag, which sidesteps module-script origin checks on file:// URLs.
import * as esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const watch = process.argv.includes("--watch");

const RENDERERS = ["session", "bridge"];

const common = {
  absWorkingDir: root,
  bundle: true,
  sourcemap: true,
  logLevel: "info",
};

const nodeTier = {
  ...common,
  platform: "node",
  format: "cjs",
  target: "node22",
};

const builds = [
  {
    ...nodeTier,
    entryPoints: ["src/main/index.js"],
    outfile: "dist/main.cjs",
    external: ["electron", "node-pty"],
  },
  {
    ...nodeTier,
    entryPoints: ["src/preload/index.js"],
    outfile: "dist/preload.cjs",
    external: ["electron"],
  },
  {
    ...common,
    entryPoints: Object.fromEntries(RENDERERS.map((name) => [`${name}/index`, `src/renderer/${name}/index.jsx`])),
    outdir: "dist/renderer",
    platform: "browser",
    format: "iife",
    target: "chrome130",
    jsx: "automatic",
    loader: { ".jsx": "jsx", ".woff2": "file", ".ttf": "file" },
  },
];

async function copyHtml() {
  for (const name of RENDERERS) {
    const outDir = path.join(root, "dist", "renderer", name);
    await mkdir(outDir, { recursive: true });
    await cp(path.join(root, "src", "renderer", name, "index.html"), path.join(outDir, "index.html"));
  }
}

await copyHtml();

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("watching for changes…");
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
