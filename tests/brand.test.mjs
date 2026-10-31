import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const catalog = read('fonts/brand-glyphs.json');

test('branding catalog contains bounded, deduplicated shapes and valid weighted choices', () => {
  assert.equal(catalog.version, 1);
  assert.equal(catalog.title, 'OSD Font Lab');
  assert.deepEqual(catalog.cell, [12, 18]);
  assert.equal(new Set(catalog.glyphs.map(g => JSON.stringify(g))).size, catalog.glyphs.length);
  for (const [top, ...rows] of catalog.glyphs) {
    assert.ok(Number.isInteger(top) && top >= 0 && top < 18);
    assert.ok(rows.length && top + rows.length <= 18);
    assert.ok(rows[0] && rows.at(-1));
    assert.ok(rows.every(r => Number.isInteger(r) && r >= 0 && r <= 4095));
  }
  for (const letter of new Set(catalog.title.toUpperCase().replaceAll(' ', ''))) {
    const choices = catalog.choices[letter];
    assert.ok(choices.length > 0 && choices.length <= catalog.sourceFontCount);
    assert.ok(choices.every(i => Number.isInteger(i) && i >= 0 && i < catalog.glyphs.length));
  }
});

test('packed logo letters reproduce original source pixels and clipped offsets', () => {
  const libraries = ['arcade-font-engine', 'atari', 'bbc', 'cpc', 'dg', 'oldschool-pc', 'zx'];
  assert.equal(libraries.reduce((n, lib) => n + read(`fonts/manifest-${lib}.json`).length, 0), catalog.sourceFontCount);
  const first = read('fonts/manifest-arcade-font-engine.json')[0];
  const font = read(`fonts/data/arcade-font-engine/${first.file}`);
  for (const letter of Object.keys(catalog.choices)) {
    const glyph = font.glyphs[`U+${letter.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`];
    const expected = new Array(216).fill(0);
    const [w, h] = glyph.size, [ox, oy] = glyph.offset;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x + ox >= 0 && x + ox < 12 && y + oy >= 0 && y + oy < 18) {
        expected[(y + oy)*12 + x + ox] = ((glyph.rows[y] >>> 0) >>> (w - 1 - x)) & 1;
      }
    }
    const actual = new Array(216).fill(0);
    const [top, ...rows] = catalog.glyphs[catalog.choices[letter][0]];
    rows.forEach((row, y) => {
      for (let x = 0; x < 12; x++) actual[(top + y)*12 + x] = (row >>> (11 - x)) & 1;
    });
    assert.deepEqual(actual, expected, letter);
  }
});
