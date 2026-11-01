import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterFontEntries, fontWindow, FONT_ROW_HEIGHT } from '../js/modules/font-browser.js';

const entries = [
  { id: 'a::same.json', libraryId: 'a', libraryLabel: 'First library', file: 'same.json', name: 'Café Classic' },
  { id: 'b::same.json', libraryId: 'b', libraryLabel: 'Second library', file: 'same.json', name: 'Café Classic' },
  { id: 'a::wide.json', libraryId: 'a', libraryLabel: 'First library', file: 'wide.json', name: 'Wide Arcade' },
];

test('font search combines library filtering, folded text and all search terms', () => {
  assert.equal(filterFontEntries(entries, '', 'CAFE classic').length, 2);
  assert.deepEqual(filterFontEntries(entries, 'b', 'cafe').map(e => e.id), ['b::same.json']);
  assert.deepEqual(filterFontEntries(entries, '', 'arcade first').map(e => e.id), ['a::wide.json']);
  assert.equal(filterFontEntries(entries, '', '[missing]').length, 0);
  assert.equal(filterFontEntries(entries, '', '   ').length, 3);
});

test('font browser keeps a bounded window while every catalog position remains reachable', () => {
  for (const count of [0, 44, 469, 1286]) {
    for (let index = 0; index < count; index++) {
      const { start, end } = fontWindow(count, index * FONT_ROW_HEIGHT, 304);
      assert.ok(start <= index && end > index);
      assert.ok(end <= count);
      assert.ok(end - start <= 9);
    }
  }
  assert.deepEqual(fontWindow(1286, 0, 0), { start: 0, end: 0 });
  assert.deepEqual(fontWindow(0, 0, 304), { start: 0, end: 0 });
});

test('compact previews cover every library font and both case samples', () => {
  for (const library of ['arcade-font-engine', 'atari', 'bbc', 'cpc', 'dg', 'hoard', 'oldschool-pc', 'zx']) {
    const read = path => JSON.parse(readFileSync(new URL(`../fonts/${path}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
    const manifest = read(`manifest-${library}.json`);
    const catalog = read(`previews/${library}.json`);
    assert.equal(catalog.version, 1);
    assert.equal(Object.keys(catalog.fonts).length, manifest.length);
    for (const entry of manifest) {
      const preview = catalog.fonts[entry.file];
      assert.ok(preview, `${library}/${entry.file}`);
      assert.ok(Object.keys(preview.glyphs).length <= 12);
      for (const sample of [preview.upper, preview.lower]) {
        assert.ok([...sample].length <= 6);
        for (const ch of sample) {
          const key = `U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
          assert.ok(preview.glyphs[key], `${library}/${entry.file}/${key}`);
        }
      }
    }
  }
});
