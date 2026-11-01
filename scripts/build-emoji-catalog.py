"""Pack emoji pixels for the picker. Run with --check to verify generated data."""
import argparse
import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'fonts/manifest-emoji-pixels.json').read_text(encoding='utf-8-sig'))
    glyphs = {}
    for entry in manifest:
        file = entry['file']
        source = json.loads((ROOT / 'fonts/data/emoji-pixels' / file).read_text(encoding='utf-8-sig'))
        pixels = source['glyph']
        if source['width'] != 12 or source['height'] != 18 or len(pixels) != 216:
            raise SystemExit(f'Unexpected emoji dimensions: {file}')
        if file in glyphs or any(pixel not in (1, 2, 3) for pixel in pixels):
            raise SystemExit(f'Invalid emoji data: {file}')
        packed = bytes(sum(pixels[i + offset] << (offset * 2) for offset in range(4))
                       for i in range(0, len(pixels), 4))
        glyphs[file] = base64.b64encode(packed).decode('ascii')
    data = (json.dumps({'version': 1, 'width': 12, 'height': 18, 'glyphs': glyphs},
                       separators=(',', ':')) + '\n').encode()
    path = ROOT / 'fonts/previews/emoji-pixels.json'
    if args.check:
        if not path.exists() or path.read_bytes() != data:
            raise SystemExit('Emoji catalog is stale; run python scripts/build-emoji-catalog.py')
    else:
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(data)
    print(f'{len(glyphs)} emoji, {len(data):,} catalog bytes')


if __name__ == '__main__':
    main()
