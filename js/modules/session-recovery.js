export const RECOVERY_DATABASE = 'osd-font-lab-recovery';
export const RECOVERY_VERSION = 1;

export function createRecoveryStore(database = () => indexedDB) {
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = database().open(RECOVERY_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions');
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Recovery storage is busy in another tab.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function transact(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('sessions', mode);
      const request = operation(transaction.objectStore('sessions'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error || request.error);
    });
  }
  return {
    read: () => transact('readonly', store => store.get('latest')),
    write: snapshot => transact('readwrite', store => store.put(snapshot, 'latest')),
    remove: () => transact('readwrite', store => store.delete('latest')),
  };
}

export function validateRecoverySnapshot(snapshot) {
  const fail = () => { throw new Error('This saved session is incomplete or from an unsupported version.'); };
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const pixels = value => value instanceof Uint8Array && value.length === 216 && value.every(p => p <= 3);
  const offset = value => value && integer(value.x, -12, 12) && integer(value.y, -12, 12);
  const entries = (value, valid) => Array.isArray(value) && value.length <= 256 &&
    new Set(value.map(e => e?.[0])).size === value.length &&
    value.every(e => Array.isArray(e) && e.length === 2 && integer(e[0], 0, 255) && valid(e[1]));
  if (!snapshot || snapshot.version !== RECOVERY_VERSION || !Number.isFinite(snapshot.savedAt) ||
      snapshot.baseFont?.width !== 12 || snapshot.baseFont?.height !== 18 ||
      snapshot.baseFont?.glyphs?.length !== 256 || !snapshot.baseFont.glyphs.every(pixels) ||
      !entries(snapshot.overrides, pixels) || !entries(snapshot.editorOffsets, offset) ||
      !entries(snapshot.nudge?.perGlyph, offset) || !offset(snapshot.nudge?.replaced) ||
      !entries(snapshot.emojiAssignments, value => typeof value === 'string') ||
      !Array.isArray(snapshot.history) || snapshot.history.length > 20 ||
      !snapshot.history.every(e => integer(e.index, 0, 255) && pixels(e.glyph) && offset(e.offset)) ||
      !['4', '8'].includes(snapshot.strokeStyle) || !['upper', 'lower'].includes(snapshot.letterCase) ||
      !integer(snapshot.ttfSize, 6, 24) || !integer(snapshot.selection?.index, 0, 255) ||
      !integer(snapshot.selection?.anchor, 0, 255) || !Array.isArray(snapshot.selection?.indices) ||
      !snapshot.selection.indices.length || snapshot.selection.indices.length > 256 ||
      !snapshot.selection.indices.every(i => integer(i, 0, 255)) ||
      !['replaced', 'selection'].includes(snapshot.nudgeTarget)) fail();
  if (snapshot.overlay !== null) {
    const glyphs = snapshot.overlay?.glyphs;
    if (!glyphs || typeof glyphs !== 'object' || Object.keys(glyphs).length > 65536) fail();
    for (const glyph of Object.values(glyphs)) {
      if (!Array.isArray(glyph.size) || !integer(glyph.size[0], 1, 32) || !integer(glyph.size[1], 1, 64) ||
          !Array.isArray(glyph.offset) || !glyph.offset.every(v => integer(v, -256, 256)) || glyph.offset.length !== 2 ||
          !Array.isArray(glyph.rows) || glyph.rows.length !== glyph.size[1] || !glyph.rows.every(Number.isInteger)) fail();
    }
  }
  if (snapshot.ttfSource !== null && (!(snapshot.ttfSource?.blob instanceof Blob) || typeof snapshot.ttfSource.name !== 'string')) fail();
  if (snapshot.clipboard !== null && (snapshot.clipboard?.width !== 12 || snapshot.clipboard?.height !== 18 || !pixels(snapshot.clipboard.pixels))) fail();
  const overridden = new Set(snapshot.overrides.map(([index]) => index));
  if (snapshot.editorOffsets.some(([index]) => !overridden.has(index))) fail();
  return snapshot;
}

// No writes occur until the previous session is restored or explicitly discarded.
export function createSessionRecovery({ store, capture, restore, onOffer = () => {}, onStatus = () => {}, delay = 250 }) {
  let initialized = false, blocked = true, unavailable = false, candidate = null, restoring = false;
  let revision = 0, savedRevision = -1, queuedRevision = -1, timer = null, writes = Promise.resolve();
  function stopTimer() { clearTimeout(timer); timer = null; }
  function failed(error) {
    unavailable = true;
    onStatus('unavailable', error);
  }
  function schedule() {
    revision++;
    stopTimer();
    if (initialized && !blocked && !unavailable) {
      onStatus('pending');
      timer = setTimeout(flush, delay);
    }
  }
  function flush() {
    stopTimer();
    if (!initialized || blocked || unavailable || savedRevision === revision || queuedRevision === revision) return writes;
    let snapshot;
    try {
      const state = capture();
      if (!state) { onStatus('ready'); return writes; }
      snapshot = structuredClone({ ...state, version: RECOVERY_VERSION, savedAt: Date.now() });
    } catch (error) { failed(error); return writes; }
    const capturedRevision = revision;
    queuedRevision = capturedRevision;
    onStatus('saving');
    writes = writes.then(async () => {
      await store.write(snapshot);
      savedRevision = capturedRevision;
      if (savedRevision === revision) onStatus('saved', snapshot.savedAt);
    }).catch(failed);
    return writes;
  }
  return {
    schedule, flush,
    async init() {
      try {
        candidate = await store.read();
        initialized = true;
        blocked = !!candidate;
        if (candidate) {
          let invalid = false;
          try { validateRecoverySnapshot(candidate); } catch { invalid = true; }
          onOffer(candidate, invalid);
          onStatus(invalid ? 'invalid' : 'waiting');
        } else {
          onStatus('ready');
          flush();
        }
      } catch (error) { initialized = true; failed(error); }
    },
    async restoreSaved() {
      if (!candidate || restoring || unavailable) return;
      restoring = true;
      onStatus('restoring');
      try {
        validateRecoverySnapshot(candidate);
        await restore(structuredClone(candidate));
        candidate = null;
        blocked = false;
        onOffer(null);
        revision++;
        await flush();
      } catch (error) { onStatus('restore-failed', error); }
      finally { restoring = false; }
    },
    async startFresh() {
      if (restoring) return;
      stopTimer();
      try {
        await writes;
        await store.remove();
        candidate = null;
        blocked = false;
        unavailable = false;
        onOffer(null);
        onStatus('ready');
        revision++;
        await flush();
      } catch (error) { failed(error); }
    },
  };
}
