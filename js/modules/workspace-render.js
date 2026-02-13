// js/modules/workspace-render.js
export function createWorkspaceRenderer({
  scale = 3,
  cols = 16,
  cssVar,
  pxColorViewer,
  fitCanvasToCSS,
  getAccentColor = () => "#ffffff",
}) {
  function drawCellGridOverlay(ctx, font) {
    const cellW = font.width * scale;
    const cellH = font.height * scale;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;

    for (let c = 0; c <= cols; c++) {
      const x = (c === cols) ? (ctx.canvas.width - 0.5) : (c * cellW + 0.5);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ctx.canvas.height);
      ctx.stroke();
    }

    for (let r = 0; r <= 16; r++) {
      const y = (r === 16) ? (ctx.canvas.height - 0.5) : (r * cellH + 0.5);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ctx.canvas.width, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function renderPlaceholderGrid(ctx, canvas, width = 12, height = 18, { showGrids } = {}) {
    const rows = Math.ceil(256 / cols);
    canvas.width = cols * width * scale;
    canvas.height = rows * height * scale;

    const matte = cssVar("--osd-matte", "#1f232b");
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (showGrids) {
      drawCellGridOverlay(ctx, { width, height });
    }
  }

  function reserveGridCanvasSpace(canvas, width = 12, height = 18) {
    const rows = Math.ceil(256 / cols);
    canvas.width = cols * width * scale;
    canvas.height = rows * height * scale;
  }

  function renderGrid(ctx, canvas, font, { showGrids, selectedSet } = {}) {
    const { glyphs, width, height } = font;
    const rows = Math.ceil(glyphs.length / cols);

    canvas.width = cols * width * scale;
    canvas.height = rows * height * scale;

    const matte = cssVar("--osd-matte", "#1f232b");
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    glyphs.forEach((glyph, i) => {
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      const ox = gx * width * scale;
      const oy = gy * height * scale;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const v = glyph[y * width + x];
          ctx.fillStyle = pxColorViewer(v);
          ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
        }
      }
    });

    if (showGrids) drawCellGridOverlay(ctx, font);

    if (selectedSet && selectedSet.size) {
      ctx.save();
      ctx.strokeStyle = getAccentColor();
      ctx.lineWidth = 1;
      for (const idx of selectedSet) {
        const sgx = idx % cols;
        const sgy = Math.floor(idx / cols);
        const sx = sgx * font.width * scale;
        const sy = sgy * font.height * scale;
        const x = sx + 0.5;
        const y = sy + 0.5;
        let w = font.width * scale - 1;
        let h = font.height * scale - 1;

        // Keep outlines fully inside the canvas so edge-cell selection
        // doesn't appear clipped on the right/bottom at some sizes.
        const maxW = (canvas.width - 0.5) - x;
        const maxH = (canvas.height - 0.5) - y;
        if (w > maxW) w = maxW;
        if (h > maxH) h = maxH;
        if (w > 0 && h > 0) ctx.strokeRect(x, y, w, h);
      }
      ctx.restore();
    }
  }

  function drawZoomPixelGrid(ctx, cellW, cellH, zoomScale, ox, oy) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= cellW; x++) {
      const xx = ox + x * zoomScale + 0.5;
      ctx.beginPath();
      ctx.moveTo(xx, oy);
      ctx.lineTo(xx, oy + cellH * zoomScale);
      ctx.stroke();
    }

    for (let y = 0; y <= cellH; y++) {
      const yy = oy + y * zoomScale + 0.5;
      ctx.beginPath();
      ctx.moveTo(ox, yy);
      ctx.lineTo(ox + cellW * zoomScale, yy);
      ctx.stroke();
    }

    ctx.restore();
  }

  function snapZoomCanvasToIntegerScale(canvas, font) {
    if (!canvas || !font) return;
    const rect = canvas.getBoundingClientRect();
    const targetW = Math.max(1, Math.floor(rect.width));
    // Ignore hidden/unstable layout passes (e.g. switching from HUD mode)
    // so we don't lock the inspector to 1x.
    if (targetW <= font.width) return;
    const cssScale = Math.max(1, Math.floor(targetW / font.width));
    canvas.style.width = `${cssScale * font.width}px`;
    canvas.style.height = `${cssScale * font.height}px`;
  }

  function renderZoom(ctx, canvas, font, index, { showGrids } = {}) {
    snapZoomCanvasToIntegerScale(canvas, font);
    fitCanvasToCSS(canvas, ctx);

    const { glyphs, width, height } = font;
    const glyph = glyphs[index];

    const matte = cssVar("--osd-matte", "#1f232b");
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const zoomScale = Math.max(1, Math.floor(Math.min(canvas.width / width, canvas.height / height)));
    const ox = Math.floor((canvas.width - width * zoomScale) / 2);
    const oy = Math.floor((canvas.height - height * zoomScale) / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = glyph[y * width + x];
        ctx.fillStyle = pxColorViewer(v);
        ctx.fillRect(ox + x * zoomScale, oy + y * zoomScale, zoomScale, zoomScale);
      }
    }

    if (showGrids) drawZoomPixelGrid(ctx, width, height, zoomScale, ox, oy);
  }

  function gridClickToIndex(e, canvas, font) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;

    const cellW = font.width * scale;
    const cellH = font.height * scale;

    const gx = Math.floor(x / cellW);
    const gy = Math.floor(y / cellH);

    const idx = gy * cols + gx;
    if (idx < 0 || idx >= 256) return null;
    return idx;
  }

  function renderFontToSheetCanvas(font, exportScale = 3) {
    const W = font.width;
    const H = font.height;
    const gridCols = 16;
    const gridRows = 16;

    const canvas = document.createElement("canvas");
    canvas.width = gridCols * W * exportScale;
    canvas.height = gridRows * H * exportScale;

    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const GRAY = "#808080";
    const WHITE = "#ffffff";
    const BLACK = "#000000";

    ctx.fillStyle = GRAY;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 256; i++) {
      const g = font.glyphs[i];
      const gx = i % gridCols;
      const gy = Math.floor(i / gridCols);
      const ox = gx * W * exportScale;
      const oy = gy * H * exportScale;

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const v = g[y * W + x];
          if (v === 1) continue;
          if (v === 2) ctx.fillStyle = WHITE;
          else if (v === 0 || v === 3) ctx.fillStyle = BLACK;
          else continue;
          ctx.fillRect(ox + x * exportScale, oy + y * exportScale, exportScale, exportScale);
        }
      }
    }

    return canvas;
  }

  return {
    gridClickToIndex,
    renderFontToSheetCanvas,
    renderGrid,
    renderPlaceholderGrid,
    renderZoom,
    reserveGridCanvasSpace,
  };
}
