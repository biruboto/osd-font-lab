import test from 'node:test';
import assert from 'node:assert/strict';
import { planTtfLayout, planTtfGlyph } from '../js/modules/ttf-overlay.js';
import { parse } from '../js/vendor/opentype-2.0.0/opentype.mjs';
import { makeOutlineFixture } from './fixtures/outline-font.mjs';

const glyphs = [
  { left: 0.1, right: 0.7, ascent: 0.8, descent: 0 },
  { left: 0, right: 0.5, ascent: 0.5, descent: 0.2 },
  { left: 0, right: 0.15, ascent: 0.15, descent: 0 },
];

test('shared letter height and individual width fits retain the outline margin', () => {
  const layout = planTtfLayout(glyphs, { sizePx: 24 });
  const epsilon = 1e-9;
  assert.ok(Math.abs(layout.effectiveSizePx - 16) < epsilon);
  for (const g of glyphs) {
    const size = layout.effectiveSizePx;
    const { x, scaleX, scaleY } = planTtfGlyph(g, layout);
    assert.ok(x - g.left * size * scaleX >= 1 - epsilon);
    assert.ok(x + g.right * size * scaleX <= 11 + epsilon);
    assert.ok(layout.baseline - g.ascent * size * scaleY >= 1 - epsilon);
    assert.ok(layout.baseline + g.descent * size * scaleY <= 17 + epsilon);
  }
  const [cap, lower, period] = glyphs;
  assert.ok(layout.baseline - cap.ascent * layout.effectiveSizePx < layout.baseline - lower.ascent * layout.effectiveSizePx);
  assert.ok(layout.baseline + lower.descent * layout.effectiveSizePx > layout.baseline);
  assert.ok(layout.baseline - period.ascent * layout.effectiveSizePx > layout.baseline - lower.ascent * layout.effectiveSizePx);
});

test('an exceptionally wide letter does not reduce the size or height of other letters', () => {
  const normal = { ch: 'H', left: 0, right: 0.5, ascent: 0.8, descent: 0 };
  const wide = { ...normal, ch: 'W', right: 2 };
  const layout = planTtfLayout([normal, wide], { sizePx: 18 });
  assert.equal(layout.effectiveSizePx, 18);
  assert.equal(planTtfGlyph(normal, layout).scaleX, 1);
  assert.ok(planTtfGlyph(wide, layout).scaleX < 0.3);
  assert.equal(planTtfGlyph(wide, layout).scaleY, 1);
});

test('tall swashes fit around the baseline without shrinking ordinary letters', () => {
  const regular = [
    ...Array.from({ length: 8 }, () => ({ ch: 'H', left: 0, right: 0.5, ascent: 0.8, descent: 0 })),
    { ch: 'g', left: 0, right: 0.5, ascent: 0.5, descent: 0.2 },
    { ch: 'p', left: 0, right: 0.5, ascent: 0.5, descent: 0.2 },
  ];
  const swash = { ch: 'B', left: 0, right: 0.5, ascent: 3, descent: 2 };
  const before = planTtfLayout(regular, { sizePx: 24 });
  const after = planTtfLayout([...regular, swash], { sizePx: 24 });
  assert.equal(after.effectiveSizePx, before.effectiveSizePx);
  assert.equal(after.baseline, before.baseline);
  assert.equal(planTtfGlyph(regular[0], after).scaleY, 1);
  const { scaleY } = planTtfGlyph(swash, after);
  assert.ok(scaleY > 0 && scaleY < 1);
  assert.ok(after.baseline - swash.ascent * after.effectiveSizePx * scaleY >= 1 - 1e-9);
  assert.ok(after.baseline + swash.descent * after.effectiveSizePx * scaleY <= 17 + 1e-9);
});

test('requested size is honored below the common fit limit', () => {
  const small = planTtfLayout(glyphs, { sizePx: 6 });
  const large = planTtfLayout(glyphs, { sizePx: 12 });
  assert.equal(small.effectiveSizePx, 6);
  assert.equal(large.effectiveSizePx, 12);
  const empty = planTtfLayout([]);
  assert.ok(Number.isFinite(empty.baseline));
});

test('capital overshoots do not steal the space needed by lowercase descenders', () => {
  const capitals = Array.from({ length: 20 }, () => ({ ch: 'H', left: 0, right: 0.5, ascent: 0.8, descent: 0.01 }));
  const descender = { ch: 'g', left: 0, right: 0.5, ascent: 0.5, descent: 0.25 };
  const layout = planTtfLayout([...capitals, descender], { sizePx: 24 });
  assert.ok(layout.baseline + descender.descent * layout.effectiveSizePx <= 17 + 1e-9);
  assert.ok(planTtfGlyph(descender, layout).scaleY >= 1 - 1e-9);
});

test('invalid dimensions and sizes fail before allocating raster buffers', () => {
  for (const options of [{ cellW: 33 }, { cellH: 0 }, { strokeMargin: 6 }, { sizePx: NaN }, { sizePx: 0 }]) {
    assert.throws(() => planTtfLayout(glyphs, options));
  }
});

test('font coverage distinguishes a supported blank from a missing character', () => {
  const font = parse(makeOutlineFixture(), { lowMemory: true });
  assert.ok(font.charToGlyphIndex('A') > 0);
  assert.ok(font.charToGlyphIndex(' ') > 0);
  assert.equal(font.charToGlyphIndex('Z'), 0);
  assert.equal(font.charToGlyphIndex('\u0378'), 0);
});
