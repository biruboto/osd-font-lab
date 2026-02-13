// js/modules/hud-render.js
export const HUD_LAYOUT_DEFAULTS = Object.freeze({
  // BETAFPV Air75 CLI defaults (Betaflight 4.5.0-rc3, decoded from osd_*_pos).
  crosshair: { col: 13, row: 6 },
  compass: { col: 10, row: 7 },
  rssi: { col: 2, row: 7 },
  link_quality: { col: 1, row: 9 },
  main_voltage: { col: 1, row: 10 },
  throttle: { col: 22, row: 10 },
  current_draw: { col: 0, row: 11 },
  mah_drawn: { col: 2, row: 12 },
  gps_sats: { col: 10, row: 7 },
  vtx_channel: { col: 1, row: 1 },
  home_distance: { col: 2, row: 3 },
  speed: { col: 10, row: 7 },
  flight_mode: { col: 5, row: 1 },
  flight_time: { col: 2, row: 12 },
  on_time: { col: 22, row: 12 },
  warnings: { col: 10, row: 10 },
  pilot_name: { col: 10, row: 7 },
  craft_name: { col: 11, row: 12 },
});

export function cloneHudLayoutDefaults() {
  return Object.fromEntries(
    Object.entries(HUD_LAYOUT_DEFAULTS).map(([id, p]) => [id, { col: p.col, row: p.row }]),
  );
}

export function createHudRenderer({
  fitCanvasToCSS,
  cssVar,
  backgroundImagePath = "",
  requestRerender = () => {},
}) {
  const HUD_COLS = 30;
  const HUD_ROWS = 16;
  let bgImage = null;
  let bgReady = false;
  let bgTried = false;

  function hudPixelColor(v) {
    // HUD preview should mimic in-goggles output: black/white/transparent only.
    if (v === 2) return "#ffffff";
    if (v === 0 || v === 3) return "#000000";
    return "rgba(0,0,0,0)";
  }

  function drawGlyph(ctx, font, glyphIndex, ox, oy, scale) {
    const glyph = font?.glyphs?.[glyphIndex];
    if (!glyph) return;
    const w = font.width;
    const h = font.height;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = glyph[y * w + x];
        if (v === 1) continue;
        const c = hudPixelColor(v);
        if (c === "rgba(0,0,0,0)") continue;
        ctx.fillStyle = c;
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
  }

  function drawText(ctx, font, text, col, row, scale, originX, originY, rowToGrid = null) {
    if (!font || !text) return;
    const glyphW = font.width * scale;
    const glyphH = font.height * scale;
    const baseX = originX + col * glyphW;
    const mappedRow = rowToGrid ? rowToGrid(row) : row;
    const baseY = originY + mappedRow * glyphH;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i) & 0xff;
      drawGlyph(ctx, font, code, baseX + i * glyphW, baseY, scale);
    }
  }

  function drawFallbackText(ctx, text, col, row, originX, originY, cellW, cellH, rowToGrid) {
    const mappedRow = rowToGrid ? rowToGrid(row) : row;
    const x = originX + col * cellW;
    const y = originY + mappedRow * cellH;
    const fontSize = Math.max(10, Math.floor(cellH * 0.45));
    ctx.save();
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawGuides(
    ctx,
    width,
    height,
    cellW,
    cellH,
    originX,
    originY,
    safeTopRows = 0,
    safeRows = HUD_ROWS,
  ) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;

    for (let c = 0; c <= HUD_COLS; c++) {
      const x = originX + c * cellW + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, originY);
      ctx.lineTo(x, originY + height);
      ctx.stroke();
    }

    for (let r = 0; r <= safeRows; r++) {
      const y = originY + (safeTopRows + r) * cellH + 0.5;
      ctx.beginPath();
      ctx.moveTo(originX, y);
      ctx.lineTo(originX + width, y);
      ctx.stroke();
    }

    const safeY = originY + safeTopRows * cellH + 0.5;
    const safeH = safeRows * cellH - 1;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(originX + 0.5, safeY, width - 1, safeH);
    ctx.setLineDash([]);

    ctx.restore();
  }

  function ensureBackgroundImage() {
    if (!backgroundImagePath || bgTried) return;
    bgTried = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      bgImage = img;
      bgReady = true;
      requestRerender();
    };
    img.onerror = () => {
      bgImage = null;
      bgReady = false;
    };
    img.src = backgroundImagePath;
  }

  function drawFallbackBackdrop(ctx, x, y, w, h) {
    const skyTop = cssVar("--bg-0", "#122235");
    const skyBottom = cssVar("--bg-2", "#304d6a");
    const ground = cssVar("--bg-3", "#3a2a20");

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(0.62, skyBottom);
    grad.addColorStop(0.621, ground);
    grad.addColorStop(1, cssVar("--bg-1", "#1f1f1f"));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = cssVar("--text-1", "#ffffff");
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.62);
    ctx.lineTo(x + w, y + h * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  function drawImageCover(ctx, canvas, x, y, w, h) {
    if (!bgReady || !bgImage) {
      drawFallbackBackdrop(ctx, x, y, w, h);
      return;
    }

    const iw = bgImage.naturalWidth || bgImage.width;
    const ih = bgImage.naturalHeight || bgImage.height;
    if (!iw || !ih) {
      drawFallbackBackdrop(ctx, x, y, w, h);
      return;
    }

    const scale = Math.max(w / iw, h / ih);
    const dw = Math.round(iw * scale);
    const dh = Math.round(ih * scale);
    const dx = Math.floor(x + (w - dw) / 2);
    const dy = Math.floor(y + (h - dh) / 2);
    ctx.drawImage(bgImage, dx, dy, dw, dh);
  }

  function renderHud(
    ctx,
    canvas,
    font,
    { showGuides = true, enabledElements = null, videoFormat = "PAL", layout = null, labels = null } = {},
  ) {
    if (!ctx || !canvas) return;
    fitCanvasToCSS(canvas, ctx);
    ctx.imageSmoothingEnabled = false;

    ensureBackgroundImage();

    const safeRows = videoFormat === "NTSC" ? 13 : 16;
    const safeTopRows = videoFormat === "NTSC" ? 1 : 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const rowToGrid = (row) => safeTopRows + clamp(Math.round(row), 0, safeRows - 1);

    const baseGlyphW = font?.width || 12;
    const baseGlyphH = font?.height || 18;
    const renderScale = Math.min(
      canvas.width / (HUD_COLS * baseGlyphW),
      canvas.height / (HUD_ROWS * baseGlyphH),
    );
    const cellW = baseGlyphW * renderScale;
    const cellH = baseGlyphH * renderScale;
    const hudW = HUD_COLS * cellW;
    const hudH = HUD_ROWS * cellH;
    const originX = Math.floor((canvas.width - hudW) / 2);
    const originY = Math.floor((canvas.height - hudH) / 2);
    const safeY = originY + safeTopRows * cellH;
    const safeH = safeRows * cellH;
    const matte = cssVar("--osd-matte", "#1f232b");
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(originX, safeY, hudW, safeH);
    ctx.clip();
    drawImageCover(ctx, canvas, originX, safeY, hudW, safeH);
    ctx.restore();
    const rowStep = cellH * (safeRows / HUD_ROWS);
    const elementRects = {};
    const elementOrder = [];
    const resolvedLayout = layout || HUD_LAYOUT_DEFAULTS;
    const formatHudLabel = (value, fallback) => {
      const text = String(value ?? "")
        .toUpperCase()
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return (text || fallback).slice(0, 12);
    };
    const pilotLabel = formatHudLabel(labels?.pilot_name, "PILOT");
    const craftLabel = formatHudLabel(labels?.craft_name, "QUADX");

    if (showGuides) {
      drawGuides(ctx, hudW, safeH, cellW, cellH, originX, safeY, 0, safeRows);
    }

    const has = (id) => !enabledElements || enabledElements.has(id);
    const pos = (id, fallbackCol, fallbackRow) => {
      const p = resolvedLayout[id] || { col: fallbackCol, row: fallbackRow };
      return {
        col: clamp(Math.round(p.col), 0, HUD_COLS - 1),
        row: clamp(Math.round(p.row), 0, safeRows - 1),
      };
    };
    const registerRect = (id, col, row, cellsWide = 1, cellsHigh = 1) => {
      const topRow = safeTopRows + row;
      const bottomRow = topRow + cellsHigh;
      const x = originX + col * cellW;
      const y = originY + topRow * cellH;
      const w = cellsWide * cellW;
      const h = Math.max(2, (bottomRow - topRow) * cellH);
      elementRects[id] = {
        x,
        y,
        w,
        h,
        col,
        row,
        cellsWide,
        cellsHigh,
      };
      elementOrder.push(id);
    };

    const C = String.fromCharCode;
    const drawHUDText = (id, glyphText, fallbackText, fallbackCol, fallbackRow) => {
      if (!has(id)) return;
      const p = pos(id, fallbackCol, fallbackRow);
      registerRect(id, p.col, p.row, glyphText.length, 1);
      if (font) {
        drawText(ctx, font, glyphText, p.col, p.row, renderScale, originX, originY, rowToGrid);
      } else {
        drawFallbackText(ctx, fallbackText, p.col, p.row, originX, originY, cellW, cellH, rowToGrid);
      }
    };

    drawHUDText("rssi", `${C(0x01)}99`, "RSSI 99", 1, 1);
    drawHUDText("main_voltage", `${C(0x97)}3.87${C(0x06)}`, "BAT 3.87V", 21, 1);
    drawHUDText("throttle", `${C(0x04)}52`, "THR 52", 21, 2);
    drawHUDText("link_quality", `${C(0x7B)}98`, "LQ 98", 1, 2);
    drawHUDText("current_draw", `3.4${C(0x9A)}`, "3.4A", 23, 2);
    drawHUDText("mah_drawn", `${C(0x07)}1290`, "MAH 1290", 22, 3);
    drawHUDText("gps_sats", `${C(0x1E)}${C(0x1F)}13`, "SAT 13", 1, 3);
    drawHUDText("vtx_channel", "R:1:25", "R:1:25", 1, 4);
    drawHUDText("home_distance", `${C(0x05)}245${C(0x0C)}`, "HOME 245M", 21, 4);
    drawHUDText("speed", `${C(0x70)}57${C(0x9E)}`, "SPD 57KPH", 1, 12);
    drawHUDText("flight_mode", "ACRO", "ACRO", 5, 1);
    drawHUDText("flight_time", `${C(0x9C)}03:21`, "FLY 03:21", 1, 14);
    drawHUDText("on_time", `${C(0x9B)}04:09`, "ON 04:09", 20, 14);
    drawHUDText("warnings", "LOW BATT", "LOW BATT", 11, 11);
    drawHUDText("pilot_name", pilotLabel, pilotLabel, 12, 13);
    drawHUDText("craft_name", craftLabel, craftLabel, 12, 14);

    if (has("compass")) {
      const p = pos("compass", 12, 0);
      registerRect("compass", p.col, p.row, 7, 1);
      if (font) {
        drawText(ctx, font, `${C(0x18)}${C(0x1C)}${C(0x1A)}${C(0x1C)}${C(0x19)}${C(0x1C)}${C(0x1B)}`, p.col, p.row, renderScale, originX, originY, rowToGrid);
      } else {
        drawFallbackText(ctx, "N - E - S - W", p.col - 2, p.row, originX, originY, cellW, cellH, rowToGrid);
      }
    }

    if (has("crosshair")) {
      const p = pos("crosshair", 15, 8);
      registerRect("crosshair", p.col - 1, p.row, 3, 1);
      if (font) {
        const midCol = p.col;
        const midRow = rowToGrid(p.row);
        drawGlyph(ctx, font, 0x72, originX + (midCol - 1) * cellW, originY + midRow * cellH, renderScale);
        drawGlyph(ctx, font, 0x73, originX + midCol * cellW, originY + midRow * cellH, renderScale);
        drawGlyph(ctx, font, 0x74, originX + (midCol + 1) * cellW, originY + midRow * cellH, renderScale);
      } else {
        drawFallbackText(ctx, "+", p.col, p.row, originX, originY, cellW, cellH, rowToGrid);
      }
    }

    return {
      elementOrder,
      elementRects,
      grid: {
        cols: HUD_COLS,
        rows: safeRows,
        originX,
        originY,
        hudW,
        hudH: safeH,
        cellW,
        cellH,
        rowStep: cellH,
        safeRows,
        safeTopRows,
      },
    };
  }

  return {
    renderHud,
  };
}
