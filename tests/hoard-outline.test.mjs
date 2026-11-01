import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyStroke4, applyStroke8 } from '../js/modules/preview.js';

const read = path => JSON.parse(readFileSync(new URL(`../fonts/${path}`, import.meta.url), 'utf8'));

test('every retained Hoard glyph keeps its complete outline in both stroke modes', () => {
  for (const entry of read('manifest-hoard.json')) {
    const font = read(`data/hoard/${entry.file}`);
    for (const [key, glyph] of Object.entries(font.glyphs)) {
      const cell = new Uint8Array(12 * 18).fill(1);
      const padded = new Uint8Array(14 * 20).fill(1);
      for (let y = 0; y < glyph.size[1]; y++) {
        for (let x = 0; x < glyph.size[0]; x++) {
          if (!(glyph.rows[y] & (1 << (glyph.size[0] - 1 - x)))) continue;
          const cx = x + glyph.offset[0], cy = y + glyph.offset[1];
          cell[cy * 12 + cx] = 2;
          padded[(cy + 1) * 14 + cx + 1] = 2;
        }
      }
      for (const stroke of [applyStroke4, applyStroke8]) {
        const expanded = stroke(padded, 14, 20);
        const actual = stroke(cell, 12, 18);
        const label = `${entry.name}/${key}/${stroke.name}`;
        // Compute the stroke with spare canvas on every side. No resulting
        // pixel may lie beyond the original cell, including diagonal corners.
        for (let y = 0; y < 20; y++) {
          for (let x = 0; x < 14; x++) {
            if (x === 0 || x === 13 || y === 0 || y === 19) {
              assert.equal(expanded[y * 14 + x], 1, `${label}: clipped stroke`);
            } else {
              assert.equal(actual[(y - 1) * 12 + x - 1], expanded[y * 14 + x], label);
            }
          }
        }
      }
    }
  }
});
