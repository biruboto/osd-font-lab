"""Convert the curated Latin hoard candidates into Font Lab JSON.

Run: python scripts/import-hoard-fonts.py
Requires the pinned archive and local monobit installation described in
docs/hoard-font-audit.md. No downloads or image scaling take place.
"""
import argparse
import base64
import collections
import csv
import hashlib
import html
import importlib.util
import io
import json
import logging
from pathlib import Path
import re
import statistics
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'docs/hoard-font-import'
DATA = ROOT / 'fonts/data/hoard'
CELL_W, CELL_H = 12, 18
STROKE_MARGIN = 1
FLAT_CAPITALS = 'HEILMNTXZ'


def module_from_file(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


audit = module_from_file('hoard_audit', 'audit-hoard-fonts.py')


def display_name(name, properties):
    """Amiga $VER headers are provenance, not picker labels."""
    header = re.match(r'^\s*\$VER:\s*', name, re.IGNORECASE)
    if not header:
        return name
    source_name = Path(properties.get('source_name', ''))
    if source_name.suffix.lower() == '.font' and source_name.stem:
        return source_name.stem
    return re.split(r'\s+\d+\.\d+(?:\.\d+)*\b', name[header.end():], maxsplit=1)[0].strip()


def source_system(path):
    """Use platform folders, not font-family or contributor folders, as context."""
    parts = path.split('/')
    if parts[0] == '|custom|':
        parts = parts[1:]
    platform, filename = parts[0], parts[-1]
    if platform == 'acorn':
        return 'Acorn BBC' if parts[1] == 'bbc' else 'Acorn'
    if platform == 'amiga':
        if parts[1] == 'workbench-3.1':
            return 'Amiga Workbench 3.1'
        if parts[1] == 'magic-workbench':
            return 'Amiga Magic Workbench'
        kickstart = re.match(r'amiga-ks(\d)(\d)-', filename)
        if kickstart:
            return f'Amiga Kickstart {kickstart[1]}.{kickstart[2]}'
        return 'Amiga'
    if platform == 'apple':
        return {'ii': 'Apple II', 'iigs': 'Apple IIgs', 'mac': 'Apple Macintosh'}[parts[1]]
    if platform == 'atari':
        return {'st': 'Atari ST', '8-bit': 'Atari 8-bit'}[parts[1]]
    if platform == 'windows':
        return parts[1].replace('windows-', 'Windows ')
    if platform == 'os-2':
        return parts[1].replace('os2_warp', 'OS/2 Warp ').replace('os2_', 'OS/2 ')
    if platform == 'gem':
        version = re.match(r'(gem|viewmax)-([\d.]+)-', filename)
        if version:
            return ('GEM ' if version[1] == 'gem' else 'GEM ViewMAX ') + version[2]
        return 'GEM'
    if platform == 'kyotronic':
        # This folder includes related machines, not just the Kyotronic itself.
        if filename.startswith('trs80-dvi-'):
            return 'TRS-80 Disk/Video Interface'
        return {'kyotronic-85.yaff': 'Kyotronic 85', 'nec-pc8201.yaff': 'NEC PC-8201',
                'nec-pc8201a.yaff': 'NEC PC-8201A',
                'olivetti-m10-uk.yaff': 'Olivetti M10', 'tandy-200.yaff': 'TRS-80'}[filename]
    if platform == 'trs-80':
        if filename.startswith('mera-elzab-meritum'):
            return 'TRS-80 / Mera Elzab Meritum'
        if parts[1] == 'coco':
            return 'TRS-80 Color Computer'
        return 'TRS-80'
    systems = {
        'amstrad': 'Amstrad', 'amstrad_setfont': 'Amstrad PCW',
        'banner': 'Banner', 'commodore': 'Commodore', 'crt8002': 'CRT8002',
        'dec': 'DEC', 'elan_enterprise': 'Elan Enterprise', 'epson': 'Epson',
        'hellschreiber': 'Hellschreiber', 'hp': 'HP 16500B', 'ibm': 'IBM',
        'msx': 'MSX', 'ncr7250': 'NCR 7250', 'next': 'NeXT', 'oberon': 'Oberon',
        'pc-geos': 'PC GEOS', 'sinclair': 'Sinclair', 'symbos': 'SymbOS',
        'teletext': 'Teletext', 'videoton_tvc': 'Videoton',
    }
    # Fail on a new platform so it cannot silently enter the library unlabelled.
    return systems[platform]


def library_name(name, properties, path):
    name = display_name(name, properties)
    system = source_system(path)
    if system.casefold() in name.casefold():
        return name
    # For example, "Atari Classic" becomes "Atari 8-bit · Classic".
    family = system.split(' ')[0]
    if system.startswith(family + ' ') and name.casefold().startswith(family.casefold() + ' '):
        name = name[len(family) + 1:]
    return f'{system} · {name}'


def lettering_baseline(glyphs):
    """Find the standing line in source coordinates, not the raster box bottom.

    Metric-bearing sources are already in baseline coordinates. A nonzero
    standing line means the source includes a global padding/origin offset.
    Removing that single offset from every glyph preserves all internal metrics.
    Raw ROM fonts with no baseline use exactly the same reference letters.
    """
    bottoms = [glyphs[c]['bounds'][1] for c in FLAT_CAPITALS if c in glyphs and any(glyphs[c]['rows'])]
    if not bottoms:
        raise ValueError('No standing-line reference letters')
    return int(statistics.median_low(bottoms))


def ink_extents(font, alphanumeric=False):
    anchor = font['anchor']
    return [(g['bounds'][3] - anchor, anchor - g['bounds'][1])
            for ch, g in font['glyphs'].items()
            if any(g['rows']) and (not alphanumeric or ch in audit.ALL_CASES)]


def capital_height(font):
    return int(statistics.median_low([
        font['glyphs'][ch]['bounds'][3] - font['anchor']
        for ch in FLAT_CAPITALS if ch in font['glyphs']
    ]))


def group_key(font):
    return (*font['size'], capital_height(font))


def plan_groups(fonts):
    """Center each face's visible capitals, independent of source cell padding.

    Faces with matching visible capital heights share the same baseline, even
    when stored in different source cells. Seven-pixel capitals get baseline 12.
    Do not move this baseline to rescue tall glyphs: cull those faces instead.
    """
    grouped = collections.defaultdict(list)
    for font in fonts:
        grouped[group_key(font)].append(font)
    plans = {}
    for size, members in sorted(grouped.items()):
        alpha = [extent for font in members for extent in ink_extents(font, True)]
        ascent = max(top for top, bottom in alpha)
        descent = max(bottom for top, bottom in alpha)
        cap_height = size[2]
        baseline = (CELL_H + cap_height) // 2
        plans[size] = {
            'size': list(size[:2]), 'baseline': baseline, 'fontCount': len(members),
            'candidateCount': len(members), 'capitalHeight': cap_height,
            'baselineBasis': 'centered-visible-capitals',
            'ascent': ascent, 'descent': descent, 'letterOutlineMargin': STROKE_MARGIN,
        }
    return plans


def convert_glyph(glyph, anchor, baseline):
    """Preserve ink exactly, discarding only blank padding around the raster."""
    left, bottom, right, top = glyph['bounds']
    width, height = right - left, top - bottom
    if not width or not height:
        return {'offset': [5, max(0, baseline - 1)], 'size': [1, 1], 'rows': [0]}
    y = baseline - (top - anchor)
    if width > CELL_W - 2 * STROKE_MARGIN or y < STROKE_MARGIN or y + height > CELL_H - STROKE_MARGIN:
        return None
    # Respect side bearings/advance while placing proportional letters in fixed
    # OSD cells. Restrict only the horizontal position when an overhang needs it.
    x = (CELL_W - glyph['advance']) // 2 + left
    x = max(STROKE_MARGIN, min(CELL_W - width - STROKE_MARGIN, x))
    first = glyph['shift'] + glyph['height'] - top
    shift_right = glyph['width'] - (right - glyph['left'])
    rows = [(row >> shift_right) & ((1 << width) - 1)
            for row in glyph['rows'][first:first + height]]
    if len(rows) != height:
        raise ValueError('Inconsistent source bounds')
    return {'offset': [x, y], 'size': [width, height], 'rows': rows}


def select_sources(fonts, plans):
    """Keep whole faces only when every supplied nonblank glyph fits its stroke."""
    kept, excluded = [], []
    for font in fonts:
        baseline = plans[group_key(font)]['baseline']
        failures = {}
        for ch, glyph in font['glyphs'].items():
            if not any(glyph['rows']):
                continue
            left, bottom, right, top = glyph['bounds']
            reasons = []
            if right - left > CELL_W - 2 * STROKE_MARGIN:
                reasons.append('ink-wider-than-10-pixels')
            if baseline - (top - font['anchor']) < STROKE_MARGIN:
                reasons.append('no-room-for-top-stroke-at-shared-baseline')
            if baseline - (bottom - font['anchor']) > CELL_H - STROKE_MARGIN:
                reasons.append('no-room-for-bottom-stroke-at-shared-baseline')
            if reasons:
                failures[ch] = reasons
        if failures:
            excluded.append({'source': font['audit']['path'], 'name': font['name'],
                             'sourceBitmapSize': font['size'], 'baseline': baseline,
                             'glyphs': failures})
        else:
            kept.append(font)
    return kept, excluded


def write_exclusions(excluded):
    with (REPORT / 'excluded.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=('source', 'name', 'sourceBitmapSize', 'baseline', 'glyphs'))
        writer.writeheader()
        for font in excluded:
            writer.writerow({**font, 'sourceBitmapSize': 'x'.join(map(str, font['sourceBitmapSize'])),
                             'glyphs': json.dumps(font['glyphs'], ensure_ascii=False)})


def apply_curation(converted):
    """Apply the approved, fixed groups instead of repeatedly fuzzy-merging."""
    selection = json.loads((ROOT / 'fonts/hoard-curation.json').read_text(encoding='utf-8'))
    by_file = {entry['file']: (entry, font) for entry, font in converted}
    if set(by_file) != set(selection['eligibleFiles']) or len(converted) != selection['inputCount']:
        raise ValueError('Stroke-safe candidates changed; review the approved Hoard curation before rebuilding')
    review = module_from_file('hoard_duplicate_review', 'review-hoard-duplicates.py')
    policy = selection['policy']
    removed, grouped, consolidated = set(), set(), []
    for group in selection['groups']:
        members = [member['file'] for member in group['members']]
        reference = group['reference']
        if reference not in members or len(members) != len(set(members)) or grouped.intersection(members):
            raise ValueError('Invalid or overlapping curation group')
        grouped.update(members)
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                if review.distance(review.letter_masks(by_file[a][1], True), review.letter_masks(by_file[b][1], True),
                                   policy['changedAlphanumericGlyphs'], policy['totalChangedPixels'],
                                   policy['maxChangedPixelsInOneGlyph']) is None:
                    raise ValueError(f'Approved duplicate group has drifted: {a}/{b}')
        reference_font = by_file[reference][1]
        variants = []
        for member in group['members']:
            if member['file'] == reference:
                continue
            removed.add(member['file'])
            variant_entry, variant_font = by_file[member['file']]
            variants.append({
                'file': member['file'], 'name': variant_entry['name'],
                'source': variant_font['_source'],
                'letterDifference': member['letterDifference'],
                'renderedDifferences': member['renderedDifferences'],
            })
            consolidated.append({'keptFile': reference, 'keptName': by_file[reference][0]['name'],
                                 'removedFile': member['file'], 'removedName': variant_entry['name'],
                                 'source': variant_font['_source']['path'],
                                 'letterDifference': member['letterDifference'],
                                 'renderedDifferences': member['renderedDifferences']})
        reference_font['_source']['variants'] = variants
    retained = [(entry, font) for entry, font in converted if entry['file'] not in removed]
    if len(retained) != selection['outputCount']:
        raise ValueError('Approved Hoard curation produced an unexpected count')
    return retained, consolidated


def write_consolidated(variants):
    with (REPORT / 'consolidated.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=('keptFile', 'keptName', 'removedFile', 'removedName', 'source', 'letterDifference', 'renderedDifferences'))
        writer.writeheader()
        for variant in variants:
            writer.writerow({**variant, 'letterDifference': json.dumps(variant['letterDifference']),
                             'renderedDifferences': json.dumps(variant['renderedDifferences'])})


def read_sources(archive_path, candidates):
    import monobit
    fonts = []
    with zipfile.ZipFile(archive_path) as archive:
        members = {name.split('/', 1)[1]: name for name in archive.namelist() if '/' in name}
        for index, row in enumerate(candidates):
            pack = monobit.load(io.BufferedReader(io.BytesIO(archive.read(members[row['path']]))), format='yaff')
            font = pack[int(row['face'])]
            font = font.label() if font.encoding else font
            if audit.source_exclusion(row['path'], str(font.name), str(font.family), str(font.encoding)):
                raise ValueError(f'Non-Latin source in candidate list: {row["path"]}')
            glyphs, skipped = {}, {}
            for ch in audit.IMPORT_CHARS:
                glyph = font.get_glyph(char=ch, missing=None)
                if glyph is None:
                    continue
                # Measure ink rather than padded source rectangles. A wide
                # provided letter must disqualify the face, not silently fall
                # back to the base font while the rest of the face is imported.
                if glyph.is_blank() and ch != ' ':
                    skipped[ch] = 'blank-source-letter-or-punctuation'
                    continue
                glyphs[ch] = {
                    'width': glyph.width, 'height': glyph.height,
                    'advance': glyph.advance_width, 'left': glyph.left_bearing,
                    'shift': glyph.shift_up, 'bounds': list(glyph.ink_bounds),
                    'rows': [sum(int(bit) << (glyph.width - 1 - x) for x, bit in enumerate(line))
                             for line in glyph.as_matrix(inklevels=(0, 1))],
                }
            if any(ch not in glyphs or not any(glyphs[ch]['rows']) for ch in audit.CORE):
                raise ValueError(f'Required letters/digits missing in {row["path"]}')
            explicit = any(k in font.get_properties() for k in ('ascent', 'descent')) or any(
                'shift_up' in glyph.get_properties() for glyph in font.glyphs)
            fonts.append({
                'audit': row, 'name': str(font.name), 'glyphs': glyphs, 'skipped': skipped,
                'anchor': lettering_baseline(glyphs),
                'baseline_mode': 'source-metrics' if explicit else 'inferred-flat-capitals',
                'size': [max(glyphs[ch]['width'] for ch in audit.CORE),
                         max(glyphs[ch]['height'] for ch in audit.CORE)],
                'properties': {key: str(value) for key, value in font.get_properties().items()},
            })
            if (index + 1) % 100 == 0:
                print(f'Parsed {index + 1}/{len(candidates)} sources', flush=True)
    return fonts


def write_gallery(converted):
    from PIL import Image, ImageDraw
    cards = []
    lines = ('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'abcdefghijklmnopqrstuvwxyz gjpqy ,;_()')
    for entry, font in sorted(converted, key=lambda item: (item[1]['_layout']['sourceBitmapSize'][1], item[1]['_layout']['sourceBitmapSize'][0], item[0]['name'])):
        baseline = font['_layout']['baseline']
        image = Image.new('RGB', (max(map(len, lines)) * 13, 40), '#15202b')
        draw = ImageDraw.Draw(image)
        for line, text in enumerate(lines):
            for col in range(len(text)):
                draw.rectangle((col * 13, line * 20, col * 13 + 11, line * 20 + 17), fill='#60727d')
            draw.line((0, line * 20 + baseline, image.width, line * 20 + baseline), fill='#327e8b')
            for index, ch in enumerate(text):
                g = font['glyphs'].get(f'U+{ord(ch):04X}')
                if not g:
                    continue
                ink = set()
                for y, row in enumerate(g['rows']):
                    for x in range(g['size'][0]):
                        if row & (1 << (g['size'][0] - 1 - x)):
                            ink.add((g['offset'][0] + x, g['offset'][1] + y))
                for x, y in ink:
                    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        if (x + dx, y + dy) not in ink:
                            draw.point((index * 13 + x + dx, line * 20 + y + dy), '#0a1016')
                for x, y in ink:
                    draw.point((index * 13 + x, line * 20 + y), '#f2f5f7')
        stream = io.BytesIO()
        image.save(stream, format='PNG')
        encoded = base64.b64encode(stream.getvalue()).decode('ascii')
        cards.append(f'<article><h2>{html.escape(entry["name"])}</h2><p>{html.escape(font["_source"]["path"])} · baseline {baseline}</p><img loading="lazy" width="{image.width * 2}" height="80" src="data:image/png;base64,{encoded}" alt="Latin lettering and descenders on a shared baseline"></article>')
    page = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Hoard of Bitfonts: baseline comparison</title><style>body{background:#0d141b;color:#f2f5f7;font:15px system-ui;margin:24px}article{padding:16px 0;border-top:1px solid #456}h2{font-size:18px;margin:0}p{color:#b8c7d4}img{image-rendering:pixelated;max-width:100%;height:auto}</style><h1>Hoard of Bitfonts</h1><p>Actual imported JSON with the 4-neighbor outline, sorted by source bitmap height and width. Each gray rectangle is a 12×18 OSD cell; the teal line marks the standing baseline. Visible capitals determine placement rather than source padding. All supplied glyphs reserve a one-pixel border for either outline style. No scaling or clipping.</p>' + ''.join(cards) + '</html>\n'
    (REPORT / 'gallery.html').write_text(page, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=ROOT / 'tools/hoard-audit/source.zip')
    parser.add_argument('--python-packages', type=Path, default=ROOT / 'tools/hoard-audit/python')
    args = parser.parse_args()
    if args.python_packages.exists():
        sys.path.insert(0, str(args.python_packages))
    REPORT.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger()
    logger.handlers.clear()
    logger.addHandler(logging.FileHandler(REPORT / 'parser.log', mode='w', encoding='utf-8'))
    candidates = list(csv.DictReader((ROOT / 'docs/hoard-font-audit/library-candidates.csv').open(encoding='utf-8')))
    source_audit = json.loads((ROOT / 'docs/hoard-font-audit/summary.json').read_text())
    archive_hash = hashlib.sha256(args.archive.read_bytes()).hexdigest()
    if archive_hash != source_audit['archive_sha256']:
        raise ValueError('Archive differs from the audited source snapshot')
    fonts = read_sources(args.archive, candidates)
    plans = plan_groups(fonts)
    fonts, excluded = select_sources(fonts, plans)
    retained_groups = collections.defaultdict(list)
    for font in fonts:
        retained_groups[group_key(font)].append(font)
    plans = {size: {**plans[size], 'fontCount': len(members),
                    'ascent': max(top for f in members for top, bottom in ink_extents(f)),
                    'descent': max(bottom for f in members for top, bottom in ink_extents(f)),
                    'letterOutlineMargin': STROKE_MARGIN}
             for size, members in sorted(retained_groups.items())}
    converted, diagnostics = [], []
    for source in fonts:
        path = source['audit']['path']
        slug = re.sub(r'[^a-z0-9]+', '-', Path(path).stem.lower()).strip('-')
        identifier = f'{slug}-{hashlib.sha256(path.encode()).hexdigest()[:10]}'
        plan = plans[group_key(source)]
        baseline = plan['baseline']
        glyphs, skipped = {}, dict(source['skipped'])
        for ch, original in source['glyphs'].items():
            glyph = convert_glyph(original, source['anchor'], baseline)
            if glyph is None:
                raise ValueError(f'Glyph would lose its stroke after eligibility checks: {path}/{ch}')
            glyphs[f'U+{ord(ch):04X}'] = glyph
        layout = {
            'sourceBitmapSize': source['size'], 'baseline': baseline,
            'sourceStandingLine': source['anchor'], 'sourceBaselineMode': source['baseline_mode'],
            'verticalTranslation': baseline + source['anchor'],
            'groupAscent': plan['ascent'], 'groupDescent': plan['descent'],
            'letterOutlineMargin': plan['letterOutlineMargin'],
            'groupCapitalHeight': plan['capitalHeight'],
            'baselineBasis': plan['baselineBasis'],
            'strokeMargin': STROKE_MARGIN,
        }
        font = {
            'cell': [12, 18], 'glyphs': glyphs, '_layout': layout,
            '_source': {
                'repository': source_audit['repository'], 'commit': source_audit['commit'],
                'path': path, 'name': source['name'], 'properties': source['properties'],
                'equivalentAuditSources': json.loads(source['audit']['equivalent_source_paths']),
            },
        }
        filename = f'{identifier}.json'
        has = lambda chars: all(any(glyphs.get(f'U+{ord(ch):04X}', {}).get('rows', [])) for ch in chars)
        entry = {
            'id': identifier, 'file': filename,
            'name': f'{library_name(source["name"], source["properties"], path)} — {source["size"][0]}x{source["size"][1]}',
            'cell': [12, 18], 'glyphCount': len(glyphs),
            'hasUpper': has(audit.UPPER), 'hasLower': has(audit.LOWER), 'hasDigits': has(audit.DIGITS),
        }
        converted.append((entry, font))
        diagnostics.append({'file': filename, 'source': path, **layout, 'skipped': skipped})
    stroke_safe_count = len(converted)
    converted, consolidated = apply_curation(converted)
    retained_sources = {font['_source']['path'] for entry, font in converted}
    fonts = [font for font in fonts if font['audit']['path'] in retained_sources]
    retained_groups = collections.defaultdict(list)
    for font in fonts:
        retained_groups[group_key(font)].append(font)
    plans = {size: {**plans[size], 'fontCount': len(members),
                    'ascent': max(top for f in members for top, bottom in ink_extents(f)),
                    'descent': max(bottom for f in members for top, bottom in ink_extents(f))}
             for size, members in sorted(retained_groups.items())}
    for entry, font in converted:
        layout = font['_layout']
        plan = plans[(*layout['sourceBitmapSize'], layout['groupCapitalHeight'])]
        layout['groupAscent'], layout['groupDescent'] = plan['ascent'], plan['descent']
        (DATA / entry['file']).write_text(json.dumps(font, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8')
    retained_files = {entry['file'] for entry, font in converted}
    diagnostics = [item for item in diagnostics if item['file'] in retained_files]
    for item in diagnostics:
        plan = plans[(*item['sourceBitmapSize'], item['groupCapitalHeight'])]
        item['groupAscent'], item['groupDescent'] = plan['ascent'], plan['descent']
    manifest = sorted((entry for entry, font in converted), key=lambda e: (e['name'].casefold(), e['id']))
    expected_files = {entry['file'] for entry in manifest}
    data_root = DATA.resolve()
    data_root.relative_to(ROOT.resolve())
    for stale in DATA.glob('*.json'):
        if stale.name not in expected_files:
            old = json.loads(stale.read_text(encoding='utf-8'))
            if stale.resolve().parent != data_root or old.get('_source', {}).get('repository') != source_audit['repository']:
                raise ValueError(f'Refusing to remove unrelated data file: {stale}')
            stale.unlink()
    (ROOT / 'fonts/manifest-hoard.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    previews = module_from_file('font_previews', 'build-font-previews.py')
    by_file = {entry['file']: font for entry, font in converted}
    catalog = {'version': 1, 'fonts': {entry['file']: previews.preview(by_file[entry['file']]) for entry in manifest}}
    (ROOT / 'fonts/previews/hoard.json').write_bytes((json.dumps(catalog, separators=(',', ':')) + '\n').encode())
    report = {
        'candidateCount': len(candidates), 'fontCount': len(converted),
        'strokeSafeCount': stroke_safe_count, 'consolidatedCount': len(consolidated),
        'curationFile': 'fonts/hoard-curation.json', 'consolidatedVariants': consolidated,
        'excludedCount': len(excluded), 'excludedFonts': excluded,
        'strokeMargin': STROKE_MARGIN, 'inkInterior': [10, 16],
        'baselinePolicy': 'Center each face using its own visible capital height; matching visible heights share a baseline regardless of source box; never move baseline to fit outliers',
        'sizeGroups': list(plans.values()),
        'sourceMetricsFonts': sum(f['baseline_mode'] == 'source-metrics' for f in fonts),
        'inferredBaselineFonts': sum(f['baseline_mode'] != 'source-metrics' for f in fonts),
        'standingLineCorrections': sum(f['baseline_mode'] == 'source-metrics' and f['anchor'] != 0 for f in fonts),
        'omittedGlyphs': sum(len(d['skipped']) for d in diagnostics),
        'baselineOmissions': sum(reason == 'cannot-fit-at-shared-baseline' for d in diagnostics for reason in d['skipped'].values()),
        'fonts': diagnostics,
    }
    (REPORT / 'layout.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    write_exclusions(excluded)
    write_consolidated(consolidated)
    write_gallery(converted)
    print(json.dumps({key: value for key, value in report.items() if key not in ('fonts', 'sizeGroups', 'excludedFonts', 'consolidatedVariants')}, indent=2))
    print(f'{len(plans)} shared baseline groups; review docs/hoard-font-import/gallery.html')


if __name__ == '__main__':
    main()
