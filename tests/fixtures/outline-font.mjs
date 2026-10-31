// Original geometric test glyphs. Generated in memory, with no installed fonts.
import { Font, Glyph, Path } from '../../js/vendor/opentype-2.0.0/opentype.mjs';

function rectangles(...boxes) {
  const path = new Path();
  for (const [x, y, w, h] of boxes) {
    path.moveTo(x, y);
    path.lineTo(x + w, y);
    path.lineTo(x + w, y + h);
    path.lineTo(x, y + h);
    path.close();
  }
  return path;
}

export function makeOutlineFixture(variant = 0) {
  const glyph = (ch, ...boxes) => new Glyph({
    name: `test${ch.codePointAt(0)}`, unicode: ch.codePointAt(0),
    advanceWidth: 900, path: rectangles(...boxes),
  });
  return new Font({
    familyName: `OSD Test ${variant}`, styleName: 'Regular',
    unitsPerEm: 1000, ascender: 800, descender: -200,
    glyphs: [
      new Glyph({ name: '.notdef', advanceWidth: 900, path: rectangles([0, 0, 600, 800]) }),
      glyph(' '),
      glyph('A', [0, 0, variant ? 300 : 600, 800]),
      glyph('B', variant === 2 ? [0, -2000, 600, 5000] : [0, 0, 600, variant ? 400 : 800]),
      glyph('H', [0, 0, 100, 800], [500, 0, 100, 800], [100, 350, 400, 100]),
      glyph('W', [-100, 0, variant === 2 ? 2400 : 800, 800]),
      glyph('x', [0, 0, 500, 500]),
      glyph('a', [0, 0, 500, 500]),
      glyph('g', [0, -200, 500, 700]),
      glyph('p', [0, -200, 100, 700], [100, 200, 400, 300]),
      glyph('.', [0, 0, 150, 150]),
      glyph(',', [0, -150, 150, 300]),
      glyph("'", [0, 650, 150, 150]),
      glyph('_', [0, -200, 600, 80]),
      glyph('-', [0, 350, 300, 80]),
      glyph('!', [0, 0, 1, 1]), // Real ink that disappears at OSD resolution.
    ],
  }).toArrayBuffer();
}
