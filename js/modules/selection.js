// js/modules/selection.js
export function createSelectionState(initialIndex = 0) {
  return {
    selectedIndex: initialIndex,
    selectedSet: new Set([initialIndex]),
    selectionAnchor: initialIndex,
  };
}

export function updateSelectionCount(selCountEl, state) {
  if (!selCountEl) return;
  selCountEl.textContent = `Selected glyphs: ${state.selectedSet.size}`;
}

export function setSingleSelection(state, idx) {
  state.selectedSet = new Set([idx]);
  state.selectionAnchor = idx;
  state.selectedIndex = idx;
}

export function toggleSelection(state, idx) {
  if (state.selectedSet.has(idx)) state.selectedSet.delete(idx);
  else state.selectedSet.add(idx);

  state.selectedIndex = idx;
  state.selectionAnchor = idx;

  if (state.selectedSet.size === 0) state.selectedSet.add(idx);
}

export function rangeSelect(state, toIdx) {
  const lo = Math.min(state.selectionAnchor, toIdx);
  const hi = Math.max(state.selectionAnchor, toIdx);
  state.selectedSet = new Set();
  for (let i = lo; i <= hi; i++) state.selectedSet.add(i);
  state.selectedIndex = toIdx;
}
