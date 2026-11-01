// Small, bounded snapshots for paint strokes and cell pastes, not view changes.
export function createCellUndoHistory(limit = 20) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Undo limit must be a positive integer");
  const entries = [];
  return {
    get size() { return entries.length; },
    snapshot() {
      return entries.map(entry => ({ index: entry.index, glyph: new Uint8Array(entry.glyph), offset: { ...entry.offset } }));
    },
    push(index, glyph, offset) {
      entries.push({ index, glyph: new Uint8Array(glyph), offset: { ...offset } });
      if (entries.length > limit) entries.shift();
    },
    pop() { return entries.pop(); },
    discard(index) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].index === index) entries.splice(i, 1);
      }
    },
    clear() { entries.length = 0; },
  };
}
