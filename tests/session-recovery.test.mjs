import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRecovery, validateRecoverySnapshot, RECOVERY_VERSION } from '../js/modules/session-recovery.js';

function snapshot() {
  return {
    version: RECOVERY_VERSION, savedAt: 100,
    baseFont: { width: 12, height: 18, glyphs: Array.from({ length: 256 }, () => new Uint8Array(216).fill(1)) },
    overlay: { glyphs: { 'U+0041': { size: [3, 2], offset: [4, 8], rows: [7, 5] } } },
    overlaySelection: { id: '', file: 'import.yaff', name: 'import.yaff' },
    overrides: [[1, new Uint8Array(216).fill(2)]], editorOffsets: [[1, { x: 1, y: 0 }]],
    history: [{ index: 1, glyph: new Uint8Array(216).fill(1), offset: { x: 0, y: 0 } }],
    clipboard: null, nudge: { replaced: { x: 0, y: 1 }, perGlyph: [[1, { x: 1, y: 0 }]] },
    nudgeTarget: 'selection', emojiAssignments: [], strokeStyle: '8', letterCase: 'lower',
    ttfSize: 12, ttfSource: null, selection: { index: 1, anchor: 1, indices: [1, 2] },
  };
}

test('recovery accepts complete layered sessions and rejects unsafe partial records', () => {
  const valid = snapshot();
  assert.equal(validateRecoverySnapshot(valid), valid);
  const ttf = { ...valid, ttfSource: { name: 'font.otf', blob: new Blob(['outline']) } };
  assert.equal(validateRecoverySnapshot(structuredClone(ttf)).ttfSource.blob.size, 7);
  for (const mutate of [s => { s.version++; }, s => { s.baseFont.glyphs.pop(); },
    s => { s.overrides[0][1][0] = 255; }, s => { s.editorOffsets[0][0] = 255; },
    s => { s.nudge.replaced.x = 99; }, s => { s.history[0].glyph = new Uint8Array(12); },
    s => { s.selection.indices = []; }, s => { s.ttfSource = { name: 'x', blob: [] }; },
    s => { s.overlay.glyphs['U+0041'].rows = []; }]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(() => validateRecoverySnapshot(invalid));
  }
});

test('an offered session is never overwritten before Restore or Start fresh', async () => {
  let record = snapshot(), work = null, writes = 0, offers = [];
  const api = createSessionRecovery({
    store: { read: async () => structuredClone(record), write: async s => { record = structuredClone(s); writes++; }, remove: async () => { record = null; } },
    capture: () => work, restore: async state => { work = state; }, onOffer: s => offers.push(s), delay: 10000,
  });
  await api.init();
  work = snapshot(); work.ttfSize = 20;
  api.schedule(); await api.flush();
  assert.equal(writes, 0);
  assert.equal(record.ttfSize, 12);
  await api.restoreSaved();
  assert.equal(work.ttfSize, 12);
  assert.equal(writes, 1);
  assert.equal(offers.at(-1), null);
  work.baseFont.glyphs[0][0] = 2;
  assert.equal(record.baseFont.glyphs[0][0], 1, 'stored pixels own their memory');
  api.schedule(); await api.flush();
  assert.equal(record.baseFont.glyphs[0][0], 2);
});

test('Start fresh explicitly replaces the old recovery with any new work', async () => {
  let record = snapshot(), work = null, removed = 0;
  const api = createSessionRecovery({
    store: { read: async () => record, write: async s => { record = s; }, remove: async () => { record = null; removed++; } },
    capture: () => work, restore: async () => {},
  });
  await api.init();
  await api.startFresh();
  assert.equal(record, null);
  assert.equal(removed, 1);
  work = snapshot(); work.ttfSize = 18;
  api.schedule(); await api.flush();
  assert.equal(record.ttfSize, 18);
});

test('slow writes stay ordered and duplicate flushes share the pending write', async () => {
  let work = null, record, release;
  const gate = new Promise(resolve => { release = resolve; });
  const sizes = [];
  const api = createSessionRecovery({
    store: { read: async () => null, remove: async () => {}, write: async s => {
      if (!sizes.length) await gate;
      record = s; sizes.push(s.ttfSize);
    } }, capture: () => work, restore: async () => {}, delay: 10000,
  });
  await api.init();
  work = snapshot(); api.schedule();
  const first = api.flush();
  assert.equal(api.flush(), first);
  work.ttfSize = 18; api.schedule(); const last = api.flush();
  release(); await last;
  assert.deepEqual(sizes, [12, 18]);
  assert.equal(record.ttfSize, 18);
});

test('failed restore retains the previous record and storage errors are contained', async () => {
  let record = snapshot(), statuses = [];
  const api = createSessionRecovery({
    store: { read: async () => record, write: async () => { throw new Error('quota'); } },
    capture: snapshot, restore: async () => { throw new Error('font unavailable'); }, onStatus: status => statuses.push(status),
  });
  await api.init(); await api.restoreSaved();
  assert.equal(statuses.at(-1), 'restore-failed');
  assert.equal(record.ttfSize, 12);
  api.schedule(); await api.flush();
  assert.equal(statuses.at(-1), 'restore-failed', 'failed restore keeps saving blocked');
  const unavailable = createSessionRecovery({
    store: { read: async () => null, write: async () => { throw new Error('quota'); } },
    capture: snapshot, restore: async () => {}, onStatus: status => statuses.push(status),
  });
  await unavailable.init(); await unavailable.flush();
  assert.equal(statuses.at(-1), 'unavailable');
  unavailable.schedule(); await unavailable.flush();
});
