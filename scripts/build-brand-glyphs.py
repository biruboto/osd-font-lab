"""Pack only the logo's letters; regenerate after changing font libraries.

Run: python scripts/build-brand-glyphs.py [--check]
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TITLE = 'OSD Font Lab'
LIBRARIES = ('arcade-font-engine', 'atari', 'bbc', 'cpc', 'dg', 'oldschool-pc', 'zx')
OUTPUT = ROOT/'fonts/brand-glyphs.json'


def cell_rows(glyph):
    """Match the existing 12x18 branding renderer, including clipped offsets."""
    rows = [0]*18
    if not glyph:
        return rows
    w, h = glyph['size']
    ox, oy = glyph['offset']
    for y in range(h):
        bits = int(glyph['rows'][y]) & 0xffffffff
        for x in range(w):
            if bits & (1 << ((w-1-x) & 31)) and 0 <= ox+x < 12 and 0 <= oy+y < 18:
                rows[oy+y] |= 1 << (11-ox-x)
    return rows


def build_catalog():
    glyphs = []
    pool = {}
    choices = {c: [] for c in dict.fromkeys(TITLE.upper().replace(' ', ''))}
    count = 0
    for library in LIBRARIES:
        manifest = json.loads((ROOT/f'fonts/manifest-{library}.json').read_text(encoding='utf-8-sig'))
        for entry in manifest:
            count += 1
            font = json.loads((ROOT/f'fonts/data/{library}'/entry['file']).read_text(encoding='utf-8-sig'))
            for char in choices:
                rows = cell_rows(font.get('glyphs', {}).get(f'U+{ord(char):04X}'))
                ink = [i for i, row in enumerate(rows) if row]
                if not ink:
                    continue  # A font without this letter must not blank the logo.
                top, bottom = ink[0], ink[-1]
                packed = (top, *rows[top:bottom+1])
                if packed not in pool:
                    pool[packed] = len(glyphs)
                    glyphs.append(packed)
                # Retain repeated choices so each eligible source font keeps its
                # original probability, even when several fonts share a shape.
                choices[char].append(pool[packed])
    return {'version': 1, 'title': TITLE, 'cell': [12, 18], 'sourceFontCount': count,
            'glyphs': glyphs, 'choices': choices}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    catalog = build_catalog()
    encoded = (json.dumps(catalog, separators=(',', ':'))+'\n').encode()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != encoded:
            raise SystemExit('Brand glyph catalog is stale; run python scripts/build-brand-glyphs.py')
    else:
        OUTPUT.write_bytes(encoded)
    print(f"Brand catalog: {catalog['sourceFontCount']} fonts, {len(catalog['glyphs'])} shapes, {len(encoded):,} bytes")


if __name__ == '__main__':
    main()
