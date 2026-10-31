export const FONT_ROW_HEIGHT = 76;

const folded = (value) => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function filterFontEntries(entries, libraryId, query) {
  const terms = folded(query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => (!libraryId || entry.libraryId === libraryId)
    && terms.every((term) => folded(`${entry.name} ${entry.file} ${entry.libraryLabel}`).includes(term)));
}

export function fontWindow(count, scrollTop, height) {
  if (!count || height <= 0) return { start: 0, end: 0 };
  return {
    start: Math.max(0, Math.min(count - 1, Math.floor(scrollTop / FONT_ROW_HEIGHT)) - 2),
    end: Math.min(count, Math.ceil((scrollTop + height) / FONT_ROW_HEIGHT) + 2),
  };
}

export function createFontBrowser({ root, libraries, initialLibraryId = '', onBrowse, onSelect, onClear, getPreviewUrl }) {
  if (!root) return;
  const library = root.querySelector('#fontLibraryFilter');
  const search = root.querySelector('#fontSearch');
  const viewport = root.querySelector('#fontResults');
  const content = root.querySelector('.font-browser-content');
  const count = root.querySelector('#fontResultsCount');
  const empty = root.querySelector('.font-browser-empty');
  const currentName = root.querySelector('#fontCurrentName');
  const currentLibrary = root.querySelector('#fontCurrentLibrary');
  const clear = root.querySelector('#clearOverlayBtn');
  let entries = [];
  let results = [];
  let applied = null;
  let pending = '';
  let active = 0;
  let unavailable = [];
  let previewEpoch = 0;
  let inFlight = 0;
  let queue = [];
  let scrollFrame = 0;
  const previews = new Map();
  const rows = new Map();

  library.replaceChildren(new Option('All libraries', ''));
  for (const lib of [...libraries].sort((a, b) => a.label.localeCompare(b.label))) {
    library.add(new Option(lib.label, lib.id));
  }
  library.value = libraries.some((lib) => lib.id === initialLibraryId) ? initialLibraryId : '';

  function setRowState(row, entry, index) {
    const selected = entry.id === applied?.id;
    row.classList.toggle('is-applied', selected);
    row.classList.toggle('is-active', index === active);
    row.setAttribute('aria-selected', String(selected));
    row.setAttribute('aria-busy', String(entry.id === pending));
    row.querySelector('.font-browser-mark').textContent = entry.id === pending ? '…' : selected ? '✓' : '';
  }

  function drainPreviews() {
    while (inFlight < 3 && queue.length) {
      const job = queue.shift();
      if (job.epoch !== previewEpoch || rows.get(job.entry.id) !== job.row) continue;
      inFlight++;
      Promise.resolve().then(() => getPreviewUrl(job.entry)).then((url) => {
        if (job.epoch !== previewEpoch) return;
        if (url) previews.set(job.entry.id, url);
        if (rows.get(job.entry.id) !== job.row) return;
        const img = job.row.querySelector('img');
        if (url) img.src = url;
        else job.row.classList.add('preview-unavailable');
      }).catch(() => {
        if (job.epoch === previewEpoch && rows.get(job.entry.id) === job.row) job.row.classList.add('preview-unavailable');
      }).finally(() => {
        inFlight--;
        drainPreviews();
      });
    }
  }

  function makeRow(entry, index) {
    const row = document.createElement('button');
    row.type = 'button';
    row.tabIndex = -1;
    row.className = 'font-browser-row';
    row.id = `font-option-${entry.index}`;
    row.dataset.fontId = entry.id;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-label', `${entry.name}, ${entry.libraryLabel}`);
    row.title = `${entry.name} — ${entry.libraryLabel}`;
    const name = document.createElement('span');
    name.className = 'font-browser-row-name';
    name.textContent = entry.name;
    const mark = document.createElement('span');
    mark.className = 'font-browser-mark';
    mark.setAttribute('aria-hidden', 'true');
    const collection = document.createElement('span');
    collection.className = 'font-browser-row-library';
    collection.textContent = entry.libraryLabel;
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'font-browser-preview';
    img.addEventListener('load', () => { img.style.width = `${img.naturalWidth * 2}px`; });
    const fallback = document.createElement('span');
    fallback.className = 'font-browser-preview-fallback';
    fallback.textContent = 'Preview unavailable';
    row.append(name, mark, collection, img, fallback);
    row.addEventListener('click', () => {
      active = results.findIndex((e) => e.id === entry.id);
      viewport.focus({ preventScroll: true });
      render();
      onSelect(entry);
    });
    content.append(row);
    rows.set(entry.id, row);
    if (previews.has(entry.id)) img.src = previews.get(entry.id);
    else queue.push({ entry, row, epoch: previewEpoch });
    return row;
  }

  function render() {
    const { start, end } = fontWindow(results.length, viewport.scrollTop, viewport.clientHeight);
    const visibleIds = new Set(results.slice(start, end).map((entry) => entry.id));
    for (const [id, row] of rows) {
      if (!visibleIds.has(id)) { row.remove(); rows.delete(id); }
    }
    queue = queue.filter((job) => rows.get(job.entry.id) === job.row && job.epoch === previewEpoch);
    for (let i = start; i < end; i++) {
      const entry = results[i];
      const row = rows.get(entry.id) || makeRow(entry, i);
      const position = content.children[i - start];
      if (position !== row) content.insertBefore(row, position || null);
      row.style.top = `${i * FONT_ROW_HEIGHT}px`;
      row.setAttribute('aria-posinset', String(i + 1));
      row.setAttribute('aria-setsize', String(results.length));
      setRowState(row, entry, i);
    }
    const focused = results[active];
    if (focused && rows.has(focused.id)) viewport.setAttribute('aria-activedescendant', rows.get(focused.id).id);
    else viewport.removeAttribute('aria-activedescendant');
    drainPreviews();
  }

  function filter() {
    results = filterFontEntries(entries, library.value, search.value);
    active = Math.max(0, results.findIndex((entry) => entry.id === applied?.id));
    viewport.scrollTop = 0;
    content.style.height = `${results.length * FONT_ROW_HEIGHT}px`;
    const suffix = unavailable.length ? ` · ${unavailable.length} ${unavailable.length === 1 ? 'library' : 'libraries'} unavailable` : '';
    count.textContent = `${results.length.toLocaleString()} ${results.length === 1 ? 'font' : 'fonts'}${suffix}`;
    empty.hidden = results.length > 0;
    empty.textContent = entries.length ? 'No fonts match. Try another name or library.' : 'Font libraries are unavailable. Reload to try again.';
    render();
  }

  library.addEventListener('change', () => { onBrowse?.(library.value); filter(); });
  search.addEventListener('input', filter);
  clear.addEventListener('click', onClear);
  viewport.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; render(); });
  });
  viewport.addEventListener('keydown', (event) => {
    const { key } = event;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Enter', ' '].includes(key) || !results.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 'Enter' || key === ' ') { onSelect(results[active]); return; }
    if (key === 'Home') active = 0;
    else if (key === 'End') active = results.length - 1;
    else active = Math.max(0, Math.min(results.length - 1, active + ({ ArrowDown: 1, ArrowUp: -1, PageDown: 4, PageUp: -4 }[key])));
    const top = active * FONT_ROW_HEIGHT;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + FONT_ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + FONT_ROW_HEIGHT - viewport.clientHeight;
    render();
  });
  new ResizeObserver(render).observe(viewport);

  return {
    setEntries(list, missing = []) {
      entries = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.libraryLabel.localeCompare(b.libraryLabel))
        .map((entry, index) => ({ ...entry, index }));
      unavailable = missing;
      for (const option of library.options) {
        const lib = libraries.find((item) => item.id === option.value);
        const total = lib ? entries.filter((e) => e.libraryId === lib.id).length : entries.length;
        option.textContent = `${lib?.label || 'All libraries'} (${total.toLocaleString()})`;
      }
      filter();
    },
    setApplied(selection) {
      applied = selection;
      currentName.textContent = selection?.name || 'Original lettering';
      currentLibrary.textContent = selection?.libraryLabel || 'Choose a replacement below';
      clear.disabled = !selection;
      render();
    },
    setPending(id) { pending = id || ''; render(); },
    refresh() {
      previewEpoch++;
      previews.clear();
      queue = [];
      for (const [id, row] of rows) {
        row.querySelector('img').removeAttribute('src');
        row.classList.remove('preview-unavailable');
        const entry = results.find((item) => item.id === id);
        if (entry) queue.push({ entry, row, epoch: previewEpoch });
      }
      drainPreviews();
    },
  };
}
