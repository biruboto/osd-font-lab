export const HUD_COLUMNS = 30;
export const HUD_ROWS = 16;

export function calculateHudLayout({ availableWidth, availableHeight = Infinity, glyphWidth = 12, glyphHeight = 18, zoom = "auto" }) {
  const maxScale = Math.max(1, Math.min(3,
    Math.floor(Math.max(0, availableWidth) / (HUD_COLUMNS * glyphWidth)),
    Math.floor(Math.max(0, availableHeight) / (HUD_ROWS * glyphHeight)),
  ));
  const requested = Number(zoom);
  const scale = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, maxScale) : maxScale;
  const cellWidth = glyphWidth * scale;
  const cellHeight = glyphHeight * scale;
  return { scale, maxScale, columns: HUD_COLUMNS, rows: HUD_ROWS, cellWidth, cellHeight,
    width: HUD_COLUMNS * cellWidth, height: HUD_ROWS * cellHeight };
}

// Match the sheet: one bitmap pixel per CSS pixel, with whole-number glyph zoom.
// The fixed HUD grid can scroll on a viewport narrower than its native 360px.
export function fitHudCanvas(canvas, ctx, font, zoom = "auto") {
  const wrapper = canvas.parentElement;
  if (!wrapper?.clientWidth || !canvas.getClientRects().length) return null;
  const panel = canvas.closest('.panel-result');
  const current = canvas.getBoundingClientRect();
  const panelBounds = panel?.getBoundingClientRect();
  const overhead = panelBounds ? panelBounds.height - current.height : 0;
  const top = (panelBounds?.top ?? current.top) + window.scrollY;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const layout = calculateHudLayout({ availableWidth: wrapper.clientWidth,
    availableHeight: viewportHeight - top - overhead - 12,
    glyphWidth: font?.width || 12, glyphHeight: font?.height || 18, zoom });
  if (canvas.width !== layout.width) canvas.width = layout.width;
  if (canvas.height !== layout.height) canvas.height = layout.height;
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;
  canvas.dataset.scale = String(layout.scale);
  canvas.dataset.maxScale = String(layout.maxScale);
  canvas.dataset.columns = String(layout.columns);
  canvas.dataset.rows = String(layout.rows);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return layout;
}
