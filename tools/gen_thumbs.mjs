// tools/gen_thumbs.mjs
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { fileURLToPath } from "node:url";

// Import your existing decoder (assumes js/mcm.js exports decodeMCM)
import { decodeMCM } from "../js/mcm.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");

const OVERLAY_MANIFEST = path.join(ROOT, "fonts", "manifest.json");
const BF_MANIFEST      = path.join(ROOT, "fonts", "bfmanifest.json");

const OVERLAY_DIR = path.join(ROOT, "fonts", "data");
const BF_DIR      = path.join(ROOT, "fonts", "betaflight");

const THUMBS_OVERLAY_DIR = path.join(ROOT, "fonts", "thumbs", "overlay");
const THUMBS_BF_DIR      = path.join(ROOT, "fonts", "thumbs", "betaflight");

const SAMPLE_TEXT = "ABC123";

// Thumb palette (baked into PNGs)
// transparent bg, white fill, black stroke
const RGBA_FILL   = [244, 233, 212, 255];
const RGBA_STROKE = [42, 43, 51, 255];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeName(s) {
  return String(s).replace(/[^a-z0-9._-]+/gi, "_");
}

function applyStroke4(cell, w, h) {
  const out = new Uint8Array(cell); // copy
  const idx = (x, y) => y * w + x;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cell[idx(x, y)] !== 2) continue; // only fill pixels

      const neighbors = [
        [x - 1, y], [x + 1, y],
        [x, y - 1], [x, y + 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = idx(nx, ny);
        if (out[n] === 1) out[n] = 3; // stroke
      }
    }
  }
  return out;
}

function renderOverlayCharCell(overlay, ch) {
  const cellW = 12, cellH = 18;
  const out = new Uint8Array(cellW * cellH);
  out.fill(1); // background marker

  if (!overlay || ch === " ") return out;

  const code = ch.charCodeAt(0);
  const key = `U+${code.toString(16).padStart(4, "0").toUpperCase()}`;
  const og = overlay.glyphs?.[key];
  if (!og) return out;

  const [w, h] = og.size;
  const [offX, offY] = og.offset;

  for (let y = 0; y < h; y++) {
    const row = og.rows[y] >>> 0;
    for (let x = 0; x < w; x++) {
      const bit = 1 << (w - 1 - x);
      if (row & bit) {
        const cx = offX + x;
        const cy = offY + y;
        if (cx >= 0 && cx < cellW && cy >= 0 && cy < cellH) {
          out[cy * cellW + cx] = 2; // fill
        }
      }
    }
  }

  return applyStroke4(out, cellW, cellH);
}

function writeStripPNG({ cells, cellW, cellH, pad = 1, outPath }) {
  const W = cells.length * (cellW + pad);
  const H = cellH;

  const png = new PNG({ width: W, height: H });

  // default is transparent, so we only set pixels for fill/stroke
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const ox = i * (cellW + pad);

    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const v = cell[y * cellW + x];

        // 1 = background, skip entirely => transparent
        if (v === 1) continue;

        const base = ((y * W) + (ox + x)) << 2;

        if (v === 2) {
          png.data[base + 0] = RGBA_FILL[0];
          png.data[base + 1] = RGBA_FILL[1];
          png.data[base + 2] = RGBA_FILL[2];
          png.data[base + 3] = RGBA_FILL[3];
        } else {
          // stroke (3) or black (0)
          png.data[base + 0] = RGBA_STROKE[0];
          png.data[base + 1] = RGBA_STROKE[1];
          png.data[base + 2] = RGBA_STROKE[2];
          png.data[base + 3] = RGBA_STROKE[3];
        }
      }
    }
  }

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, PNG.sync.write(png));
}

function makeOverlayThumb(overlay) {
  const chars = [...SAMPLE_TEXT];
  const cells = chars.map(ch => renderOverlayCharCell(overlay, ch));
  writeStripPNG({
    cells,
    cellW: 12,
    cellH: 18,
    pad: 1,
    outPath: overlay.__outPath,
  });
}

function makeBetaflightThumb(font) {
  const W = font.width, H = font.height;
  const chars = [...SAMPLE_TEXT];

  const cells = chars.map(ch => {
    const code = ch.charCodeAt(0);
    const g = font.glyphs[code] || font.glyphs[0];
    // normalize to 12x18 expected; BF should already be 12x18
    return g;
  });

  // For MCM: treat 1 as background (transparent), 2 white, 0/3 black
  const normalizedCells = cells.map(g => {
    const out = new Uint8Array(W * H);
    for (let i = 0; i < out.length; i++) {
      const v = g[i];
      if (v === 1) out[i] = 1;
      else if (v === 2) out[i] = 2;
      else out[i] = 3; // 0 or 3 => black
    }
    return out;
  });

  writeStripPNG({
    cells: normalizedCells,
    cellW: W,
    cellH: H,
    pad: 1,
    outPath: font.__outPath,
  });
}

function loadJSON(p) {
  let s = fs.readFileSync(p, "utf8");
  // Strip UTF-8 BOM if present
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return JSON.parse(s);
}


function saveJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function main() {
  ensureDir(THUMBS_OVERLAY_DIR);
  ensureDir(THUMBS_BF_DIR);

  // ---- overlay thumbs ----
  const overlays = loadJSON(OVERLAY_MANIFEST);
  for (const entry of overlays) {
    const file = entry.file;                 // overlay JSON filename
    const srcPath = path.join(OVERLAY_DIR, file);

    const overlay = loadJSON(srcPath);
    const thumbName = safeName(file.replace(/\.json$/i, "")) + ".png";
    const outPath = path.join(THUMBS_OVERLAY_DIR, thumbName);

    overlay.__outPath = outPath;
    makeOverlayThumb(overlay);

    // optionally write thumb into manifest
    entry.thumb = `thumbs/overlay/${thumbName}`;
  }
  saveJSON(OVERLAY_MANIFEST, overlays);

  // ---- betaflight thumbs ----
  const bfs = loadJSON(BF_MANIFEST);
  for (const entry of bfs) {
    const file = entry.file;                 // .mcm filename
    const srcPath = path.join(BF_DIR, file);

    const buf = fs.readFileSync(srcPath);
    const font = decodeMCM(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

    const thumbName = safeName(file.replace(/\.mcm$/i, "")) + ".png";
    const outPath = path.join(THUMBS_BF_DIR, thumbName);

    font.__outPath = outPath;
    makeBetaflightThumb(font);

    entry.thumb = `thumbs/betaflight/${thumbName}`;
  }
  saveJSON(BF_MANIFEST, bfs);

  console.log("✅ Thumbnails generated and manifests updated.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
