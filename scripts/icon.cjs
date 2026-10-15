// Renders build/icon.png (512x512, transparent corners) from an inline SVG
// with Electron's offscreen renderer, so no image library is needed; even
// offscreen, a window is clamped to the primary display, so 512 is the safe
// size. electron-builder derives the Windows .ico and macOS .icns from it.
// Run with `npm run icon`.
const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const SIZE = 512;

// A dark rounded tile, a purple-to-blue ring, a bold H, and three small
// bars beneath: many hands, one body.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1024 1024" style="display:block">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a855f7"/>
      <stop offset="1" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect x="48" y="48" width="928" height="928" rx="200" fill="#1a1a1a"/>
  <circle cx="512" cy="470" r="300" fill="none" stroke="url(#g)" stroke-width="52"/>
  <g fill="#f3f4f6">
    <rect x="372" y="290" width="80" height="360" rx="18"/>
    <rect x="572" y="290" width="80" height="360" rx="18"/>
    <rect x="372" y="430" width="280" height="80" rx="18"/>
  </g>
  <g fill="url(#g)">
    <rect x="296" y="868" width="128" height="40" rx="20"/>
    <rect x="448" y="868" width="128" height="40" rx="20"/>
    <rect x="600" y="868" width="128" height="40" rx="20"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>${SVG}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const alphaAt = (x, y) => bitmap[(y * width + x) * 4 + 3];
  const outDir = path.join(__dirname, "..", "build");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "icon.png"), image.toPNG());
  console.log(
    `wrote build/icon.png ${width}x${height}; corner alpha ${alphaAt(4, 4)}, centre alpha ${alphaAt(256, 256)}`,
  );
  app.exit(width === SIZE && height === SIZE && alphaAt(4, 4) === 0 ? 0 : 1);
});
