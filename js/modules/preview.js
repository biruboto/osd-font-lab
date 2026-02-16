// js/modules/preview.js
export function applyStroke4(cell, w, h) {
  const out = new Uint8Array(cell);
  const idx = (x, y) => y * w + x;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cell[idx(x, y)] !== 2) continue;

      const neighbors = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = idx(nx, ny);
        if (out[n] === 1) out[n] = 3;
      }
    }
  }

  return out;
}

export function applyStroke8(cell, w, h) {
  const out = new Uint8Array(cell);
  const idx = (x, y) => y * w + x;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cell[idx(x, y)] !== 2) continue;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = idx(nx, ny);
          if (out[n] === 1) out[n] = 3;
        }
      }
    }
  }

  return out;
}

export function drawFontPreviewStrip(font, text = "ABC123", pxColor) {
  if (!font?.glyphs) return "";

  const W = font.width;
  const H = font.height;
  const pad = 1;
  const chars = [...text];
  const cw = W + pad;

  const canvas = document.createElement("canvas");
  canvas.width = chars.length * cw;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  chars.forEach((ch, i) => {
    const code = ch.charCodeAt(0);
    const g = font.glyphs[code] || font.glyphs[0];
    const ox = i * cw;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = g[y * W + x];
        if (v === 1) continue;
        ctx.fillStyle = pxColor(v);
        ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  });

  return canvas.toDataURL("image/png");
}

export function drawGlyphPreviewStrip(
  glyphs,
  width = 12,
  height = 18,
  pad = 1,
  pxColor,
) {
  const list = (glyphs || []).filter(Boolean);
  if (!list.length) return "";

  const canvas = document.createElement("canvas");
  canvas.width = list.length * (width + pad);
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  list.forEach((g, gi) => {
    const ox = gi * (width + pad);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = g[y * width + x];
        if (v === 1) continue;
        ctx.fillStyle = pxColor(v);
        ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  });

  return canvas.toDataURL("image/png");
}

function renderOverlayPreviewCell(overlay, ch, strokeMode = "4") {
  const cellW = 12;
  const cellH = 18;
  const out = new Uint8Array(cellW * cellH);
  out.fill(1);

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
      if (!(row & bit)) continue;
      const cx = offX + x;
      const cy = offY + y;
      if (cx >= 0 && cx < cellW && cy >= 0 && cy < cellH) {
        out[cy * cellW + cx] = 2;
      }
    }
  }

  return (strokeMode === "8")
    ? applyStroke8(out, cellW, cellH)
    : applyStroke4(out, cellW, cellH);
}

function measureCellInkBounds(cell, cellW, cellH) {
  let minX = cellW;
  let maxX = -1;

  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      const v = cell[y * cellW + x];
      if (v === 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }

  if (maxX < minX) return null;
  return { minX, maxX, width: maxX - minX + 1 };
}

export function drawOverlayPreviewStrip(overlay, text = "ABC123", pxColor, strokeMode = "4") {
  const cellW = 12;
  const cellH = 18;
  const gap = 2;
  const chars = [...text];

  const cells = chars.map((ch) => renderOverlayPreviewCell(overlay, ch, strokeMode));
  const widths = cells.map((cell, i) => {
    const ch = chars[i];
    const bounds = measureCellInkBounds(cell, cellW, cellH);
    if (bounds) return bounds.width;
    if (ch === " ") return 4;
    return 2;
  });

  const totalWidth =
    widths.reduce((sum, w) => sum + w, 0) + Math.max(0, widths.length - 1) * gap;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, totalWidth);
  canvas.height = cellH;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  let penX = 0;
  chars.forEach((ch, i) => {
    const cell = cells[i];
    const bounds = measureCellInkBounds(cell, cellW, cellH);
    const drawWidth = widths[i];
    const srcX = bounds ? bounds.minX : 0;

    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < drawWidth; x++) {
        const sx = srcX + x;
        if (sx < 0 || sx >= cellW) continue;
        const vv = cell[y * cellW + sx];
        if (vv === 1) continue;
        ctx.fillStyle = pxColor(vv);
        ctx.fillRect(penX + x, y, 1, 1);
      }
    }

    penX += drawWidth + (i < chars.length - 1 ? gap : 0);
  });

  return canvas.toDataURL("image/png");
}
