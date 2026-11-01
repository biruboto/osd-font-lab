"""Review exact and near-duplicate lettering without changing the live library.

Run: python scripts/review-hoard-duplicates.py
Ignores horizontal bearing-only differences for letterform grouping. Requires
matching alphanumeric coverage and checks every pair in a group, avoiding chains
of progressively less similar fonts. The HTML review uses the actual JSON pixels.
"""
import argparse
import base64
import collections
import html
import io
import itertools
import json
from pathlib import Path
import string

ROOT = Path(__file__).resolve().parents[1]
LETTERS = string.ascii_uppercase + string.ascii_lowercase + string.digits


def mask(glyph, ignore_x=False):
    if glyph is None:
        return None
    x, y = glyph['offset']
    if ignore_x:
        x = 0
    return sum(row << (12 * (17 - y - line) + 12 - glyph['size'][0] - x)
               for line, row in enumerate(glyph['rows']))


def letter_masks(font, ignore_x=False):
    return tuple(mask(font['glyphs'].get(f'U+{ord(ch):04X}'), ignore_x) for ch in LETTERS)


def distance(left, right, max_glyphs, max_pixels, max_per_glyph):
    changed, total = [], 0
    for ch, a, b in zip(LETTERS, left, right):
        if a == b:
            continue
        if a is None or b is None:
            return None  # coverage changes are reviewed separately, never merged
        pixels = (a ^ b).bit_count()
        changed.append({'character': ch, 'pixels': pixels})
        total += pixels
        if len(changed) > max_glyphs or total > max_pixels or pixels > max_per_glyph:
            return None
    return {'changedLetters': changed, 'pixels': total}


def full_differences(left, right):
    differences = []
    for key in sorted(left['glyphs'].keys() | right['glyphs'].keys()):
        a, b = mask(left['glyphs'].get(key)), mask(right['glyphs'].get(key))
        if a != b:
            differences.append({'character': chr(int(key[2:], 16)),
                                'pixels': None if a is None or b is None else (a ^ b).bit_count()})
    return differences


def preview(font, text, highlight):
    from PIL import Image, ImageDraw
    image = Image.new('RGB', (13 * len(text), 18), '#15202b')
    draw = ImageDraw.Draw(image)
    for index, ch in enumerate(text):
        draw.rectangle((index * 13, 0, index * 13 + 11, 17),
                       fill='#8c6c42' if ch in highlight else '#60727d')
        glyph = font['glyphs'].get(f'U+{ord(ch):04X}')
        if glyph is None:
            continue
        points = {(glyph['offset'][0] + x, glyph['offset'][1] + y)
                  for y, row in enumerate(glyph['rows']) for x in range(glyph['size'][0])
                  if row & (1 << (glyph['size'][0] - 1 - x))}
        stroke = {(x + dx, y + dy) for x, y in points
                  for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1))} - points
        for color, pixels in (('#0a1016', stroke), ('#f2f5f7', points)):
            for x, y in pixels:
                draw.point((index * 13 + x, y), color)
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return base64.b64encode(stream.getvalue()).decode('ascii'), image.width * 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-glyphs', type=int, default=2)
    parser.add_argument('--max-pixels', type=int, default=8)
    parser.add_argument('--max-per-glyph', type=int, default=6)
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'fonts/manifest-hoard.json').read_text(encoding='utf-8'))
    fonts = [json.loads((ROOT / 'fonts/data/hoard' / entry['file']).read_text(encoding='utf-8'))
             for entry in manifest]
    rendered = [letter_masks(font) for font in fonts]
    shapes = [letter_masks(font, True) for font in fonts]
    allowed = {}
    for a, b in itertools.combinations(range(len(fonts)), 2):
        delta = distance(shapes[a], shapes[b], args.max_glyphs, args.max_pixels, args.max_per_glyph)
        if delta is not None:
            allowed[(a, b)] = delta

    groups = {i: {i} for i in range(len(fonts))}
    owner = list(range(len(fonts)))
    # Closest pairs first. Every member must fit the threshold against every
    # other member, rather than only against a representative or one neighbor.
    for (a, b), delta in sorted(allowed.items(), key=lambda item: (
            len(item[1]['changedLetters']), item[1]['pixels'], item[0])):
        ra, rb = owner[a], owner[b]
        if ra == rb:
            continue
        if all(tuple(sorted((i, j))) in allowed for i in groups[ra] for j in groups[rb]):
            first, second = min(ra, rb), max(ra, rb)
            groups[first].update(groups.pop(second))
            for i in groups[first]:
                owner[i] = first

    def rank(i):
        # This is just a review-page default, not an automatic library edit.
        return (-len(fonts[i]['glyphs']), manifest[i]['name'].casefold(), manifest[i]['file'])

    clusters = []
    for members in groups.values():
        if len(members) < 2:
            continue
        ordered = sorted(members, key=rank)
        reference = ordered[0]
        pairs = [allowed[tuple(sorted((i, j)))] for i, j in itertools.combinations(ordered, 2)]
        clusters.append({
            'type': 'same-letterforms' if all(not pair['changedLetters'] for pair in pairs) else 'near-letterforms',
            'reference': manifest[reference]['file'],
            'maximumChangedLetters': max(len(pair['changedLetters']) for pair in pairs),
            'maximumLetterPixels': max(pair['pixels'] for pair in pairs),
            'members': [{
                'file': manifest[i]['file'], 'name': manifest[i]['name'],
                'source': fonts[i]['_source']['path'],
                'letterDifference': allowed[tuple(sorted((reference, i)))] if reference != i else {'changedLetters': [], 'pixels': 0},
                'renderedDifferences': full_differences(fonts[reference], fonts[i]),
            } for i in ordered],
        })
    clusters.sort(key=lambda group: (-len(group['members']), group['members'][0]['name'].casefold()))
    summary = {
        'libraryEntries': len(fonts),
        'exactFullRenderedSets': len({tuple((key, mask(glyph)) for key, glyph in sorted(font['glyphs'].items())) for font in fonts}),
        'exactRenderedAlphanumericSets': len(set(rendered)),
        'exactAlphanumericLetterformSets': len(set(shapes)),
        'nearDuplicateGroupsIncludingSingletons': len(groups),
        'multiEntryGroups': len(clusters),
        'entriesInMultiEntryGroups': sum(len(group['members']) for group in clusters),
        'threshold': {'changedAlphanumericGlyphs': args.max_glyphs, 'totalChangedPixels': args.max_pixels,
                      'maxChangedPixelsInOneGlyph': args.max_per_glyph,
                      'ignoreHorizontalPositionOnly': True, 'requireMatchingCoverage': True,
                      'allPairsMustMatch': True},
        'libraryChanged': False,
    }
    report = ROOT / 'docs/hoard-font-import'
    (report / 'near-duplicates.json').write_text(json.dumps({'summary': summary, 'groups': clusters}, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    by_file = {entry['file']: font for entry, font in zip(manifest, fonts)}
    sections = []
    for group in clusters:
        differing = {d['character'] for member in group['members'] for d in member['renderedDifferences']}
        sample = 'ABCDEF 0123456789 gjpqy -='
        sample += ''.join(ch for ch in sorted(differing) if ch not in sample)
        rows = []
        for member in group['members']:
            src, width = preview(by_file[member['file']], sample, differing)
            changed = ', '.join(repr(d['character']) + (': coverage' if d['pixels'] is None else f': {d["pixels"]} px')
                                for d in member['renderedDifferences']) or 'reference'
            rows.append(f'<div class="member"><h3>{html.escape(member["name"])}</h3><p>{html.escape(member["source"])}</p><img loading="lazy" width="{width}" height="36" src="data:image/png;base64,{src}" alt="Actual font glyphs; differences highlighted"><p>Rendered differences from first row: {html.escape(changed)}</p></div>')
        title = 'Same alphanumeric letterforms' if group['type'] == 'same-letterforms' else 'Near-identical alphanumeric letterforms'
        sections.append(f'<section><h2>{title} — {len(group["members"])} candidates</h2><p>Maximum pairwise difference: {group["maximumChangedLetters"]} alphanumeric characters / {group["maximumLetterPixels"]} ink pixels (ignoring horizontal positioning).</p>{"".join(rows)}</section>')
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Hoard near-duplicate review</title>
<style>body{{background:#0d141b;color:#edf2f5;font:15px system-ui;margin:24px;max-width:1250px}}section{{border-top:1px solid #456;padding:20px 0}}h2{{font-size:20px}}h3{{font-size:16px;margin-bottom:6px}}p{{color:#b8c7d4}}img{{image-rendering:pixelated;max-width:100%;height:auto}}.member{{padding:12px;background:#15202b;margin:10px 0}}</style>
<h1>Hoard near-duplicate review</h1><p>The live library is unchanged. {summary['libraryEntries']} entries → {summary['exactRenderedAlphanumericSets']} exact rendered alphanumeric sets → {summary['exactAlphanumericLetterformSets']} letterform sets when horizontal positioning alone is ignored → {len(groups)} proposed groups using the conservative tolerance below.</p>
<p>Threshold: matching A–Z/a–z/0–9 coverage; at most {args.max_glyphs} differing alphanumeric glyphs, {args.max_pixels} changed ink pixels in total, and {args.max_per_glyph} in any one glyph. Every pair in a group must pass. Punctuation differences are shown for review, but do not define a separate lettering style. Amber cells mark characters that differ in actual rendered output; black outlines match the app's 4-neighbor stroke.</p>
<p>The first row is a deterministic review reference, favoring fuller glyph coverage. Final representative selection should consider readability (especially 0/O and 1/I), punctuation, provenance, and existing library overlap. These groups are suggestions, not approved removals.</p>
{''.join(sections)}</html>\n'''
    (report / 'near-duplicates.html').write_text(page, encoding='utf-8')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
