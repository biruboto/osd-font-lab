// Display geometry only. PNG exports keep their separate 16-column layout.
export function calculateSheetLayout({
  availableWidth,
  availableHeight = Infinity,
  glyphWidth = 12,
  glyphHeight = 18,
  glyphCount = 256,
  zoom = "auto",
}) {
  const width = Math.max(0, Math.floor(availableWidth));
  const geometry = (scale) => {
    const cellWidth = glyphWidth * scale;
    const cellHeight = glyphHeight * scale;
    const columns = Math.min(glyphCount, Math.max(1, Math.floor(width / cellWidth)));
    const rows = Math.ceil(glyphCount / columns);
    return { scale, columns, rows, cellWidth, cellHeight,
      width: columns * cellWidth, height: rows * cellHeight, glyphCount };
  };
  const requested = Number(zoom);
  if ([2, 3, 4].includes(requested)) return geometry(requested);
  // Keep glyphs readable at 2x even when the whole font needs vertical scrolling.
  for (let scale = 4; scale >= 2; scale--) {
    const layout = geometry(scale);
    if (layout.width <= width && layout.height <= availableHeight) return layout;
  }
  return geometry(2);
}

export function sheetPointToIndex(x, y, layout) {
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return null;
  const column = Math.floor(x / layout.cellWidth);
  const row = Math.floor(y / layout.cellHeight);
  const index = row * layout.columns + column;
  return index < layout.glyphCount ? index : null;
}
