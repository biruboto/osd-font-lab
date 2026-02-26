// js/modules/ttf-overlay.js
const DEFAULT_CELL_W = 12;
const DEFAULT_CELL_H = 18;
const DEFAULT_STROKE_MARGIN = 1;
const DEFAULT_OVERSAMPLE = 4;
const DEFAULT_THRESHOLD = 96;

function uniqueCodepointsFromText(text) {
  const cps = [];
  const seen = new Set();
  for (const ch of String(text || "")) {
    const cp = ch.codePointAt(0);
    if (!Number.isInteger(cp) || cp < 0 || cp > 0xffff) continue;
    if (seen.has(cp)) continue;
    seen.add(cp);
    cps.push(cp);
  }
  return cps;
}

function anyInk(mask) {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) return true;
  }
  return false;
}

function maskToRows(mask, w, h) {
  const rows = new Array(h);
  for (let y = 0; y < h; y++) {
    let bits = 0;
    for (let x = 0; x < w; x++) {
      bits <<= 1;
      if (mask[y * w + x]) bits |= 1;
    }
    rows[y] = bits >>> 0;
  }
  return rows;
}

function alphaBBox(alpha, w, h, threshold = 8) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[(y * w + x) * 4 + 3];
      if (a < threshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

function drawCodepointMask(cp, {
  family,
  sizePx,
  cellW,
  cellH,
  strokeMargin,
  oversample,
  threshold,
}) {
  const innerW = Math.max(1, cellW - strokeMargin * 2);
  const innerH = Math.max(1, cellH - strokeMargin * 2);
  const ch = String.fromCodePoint(cp);

  const srcW = 256;
  const srcH = 256;
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  srcCtx.clearRect(0, 0, srcW, srcH);
  srcCtx.fillStyle = "#ffffff";
  srcCtx.textAlign = "left";
  srcCtx.textBaseline = "alphabetic";
  srcCtx.imageSmoothingEnabled = true;
  srcCtx.font = `${Math.max(1, sizePx * oversample)}px "${family}"`;

  const metrics = srcCtx.measureText(ch);
  const textW = Number(metrics.width) || 0;
  const left = Number(metrics.actualBoundingBoxLeft) || 0;
  const asc = Number(metrics.actualBoundingBoxAscent) || 0;
  const desc = Number(metrics.actualBoundingBoxDescent) || 0;

  const x = Math.floor((srcW - textW) / 2 - left);
  const y = Math.floor(srcH / 2 + (asc - desc) / 2);
  srcCtx.fillText(ch, x, y);

  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;
  const box = alphaBBox(srcData, srcW, srcH, 8);
  if (!box) return new Uint8Array(cellW * cellH);

  const naturalW = Math.max(1, Math.ceil(box.w / oversample));
  const naturalH = Math.max(1, Math.ceil(box.h / oversample));
  const fit = Math.min(1, innerW / naturalW, innerH / naturalH);
  const drawW = Math.max(1, Math.round(naturalW * fit));
  const drawH = Math.max(1, Math.round(naturalH * fit));
  const dx = strokeMargin + Math.floor((innerW - drawW) / 2);
  const dy = strokeMargin + Math.floor((innerH - drawH) / 2);

  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = cellW;
  dstCanvas.height = cellH;
  const dstCtx = dstCanvas.getContext("2d", { willReadFrequently: true });
  dstCtx.clearRect(0, 0, cellW, cellH);
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.drawImage(
    srcCanvas,
    box.x,
    box.y,
    box.w,
    box.h,
    dx,
    dy,
    drawW,
    drawH,
  );

  const dstData = dstCtx.getImageData(0, 0, cellW, cellH).data;
  const mask = new Uint8Array(cellW * cellH);
  for (let i = 0, j = 3; i < mask.length; i++, j += 4) {
    mask[i] = dstData[j] >= threshold ? 1 : 0;
  }
  return mask;
}

export async function parseTtfToOverlay(file, {
  cellW = DEFAULT_CELL_W,
  cellH = DEFAULT_CELL_H,
  strokeMargin = DEFAULT_STROKE_MARGIN,
  sizePx = 12,
  charset = "",
  oversample = DEFAULT_OVERSAMPLE,
  threshold = DEFAULT_THRESHOLD,
} = {}) {
  const bytes = await file.arrayBuffer();
  const family = `osd_ttf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const fontFace = new FontFace(family, bytes);
  await fontFace.load();
  document.fonts.add(fontFace);

  const glyphs = {};
  const cps = uniqueCodepointsFromText(charset);
  const stats = {
    attempted: cps.length,
    imported: 0,
    empty: 0,
    skippedOutOfRange: 0,
  };

  try {
    for (const cp of cps) {
      if (!Number.isInteger(cp) || cp < 0 || cp > 0xffff) {
        stats.skippedOutOfRange += 1;
        continue;
      }
      const mask = drawCodepointMask(cp, {
        family,
        sizePx: Math.max(1, Number(sizePx) || 12),
        cellW,
        cellH,
        strokeMargin: Math.max(0, Number(strokeMargin) || 0),
        oversample: Math.max(1, Number(oversample) || DEFAULT_OVERSAMPLE),
        threshold: Math.max(1, Math.min(254, Number(threshold) || DEFAULT_THRESHOLD)),
      });
      if (!anyInk(mask)) {
        stats.empty += 1;
        continue;
      }
      const key = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
      glyphs[key] = {
        offset: [0, 0],
        size: [cellW, cellH],
        rows: maskToRows(mask, cellW, cellH),
      };
      stats.imported += 1;
    }
  } finally {
    document.fonts.delete(fontFace);
  }

  return {
    cell: [cellW, cellH],
    glyphs,
    _importStats: {
      source: "ttf",
      sizePx: Math.max(1, Number(sizePx) || 12),
      ...stats,
      glyphsImported: Object.keys(glyphs).length,
    },
  };
}
