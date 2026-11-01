"""Build compact font-browser previews. Run with --check to verify generated data."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIBRARIES = ('arcade-font-engine', 'atari', 'bbc', 'cpc', 'dg', 'hoard', 'oldschool-pc', 'zx')


def key(ch):
    return f'U+{ord(ch):04X}'


def preview(font):
    glyphs = font.get('glyphs', {})

    def has_ink(ch):
        return any(glyphs.get(key(ch), {}).get('rows', []))

    fallback = []
    for code in sorted(glyphs):
        cp = int(code[2:], 16)
        if 0x20 < cp <= 0xffff and cp != 0x7f and has_ink(chr(cp)):
            fallback.append(chr(cp))
    upper = 'ABC123'
    lower = ''.join(ch.lower() if has_ink(ch.lower()) else ch for ch in upper)
    upper = upper if all(has_ink(ch) for ch in upper) else ''.join(fallback[:6])
    lower = lower if all(has_ink(ch) for ch in lower) else upper
    return {
        'upper': upper, 'lower': lower,
        'glyphs': {key(ch): glyphs[key(ch)] for ch in dict.fromkeys(upper + lower)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    output = ROOT/'fonts/previews'
    if not args.check:
        output.mkdir(exist_ok=True)
    for library in LIBRARIES:
        manifest = json.loads((ROOT/f'fonts/manifest-{library}.json').read_text(encoding='utf-8-sig'))
        fonts = {}
        for entry in manifest:
            font = json.loads((ROOT/f'fonts/data/{library}'/entry['file']).read_text(encoding='utf-8-sig'))
            fonts[entry['file']] = preview(font)
        data = (json.dumps({'version': 1, 'fonts': fonts}, separators=(',', ':'))+'\n').encode()
        path = output/f'{library}.json'
        if args.check:
            if not path.exists() or path.read_bytes() != data:
                raise SystemExit(f'{path.name} is stale; run python scripts/build-font-previews.py')
        else:
            path.write_bytes(data)
        print(f'{library}: {len(fonts)} fonts, {len(data):,} preview bytes')


if __name__ == '__main__':
    main()
