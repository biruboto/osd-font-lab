"""Audit a pinned hoard-of-bitfonts ZIP without changing the website.

Requires monobit==0.54.0 (and Pillow for the review gallery). Example:
  python scripts/audit-hoard-fonts.py tools/hoard-audit/source.zip

The ZIP is read in place because upstream paths include Windows-illegal names.
Only explicit Unicode labels and declared encodings qualify automatically.
Unmapped legacy codepoints are deliberately not assumed to be ASCII.
"""
import argparse
import collections
import csv
import hashlib
import html
import io
import json
import logging
from pathlib import Path
import re
import string
import subprocess
import sys
import unicodedata
import zipfile

ROOT = Path(__file__).resolve().parents[1]
UPPER = string.ascii_uppercase
LOWER = string.ascii_lowercase
DIGITS = string.digits
CORE = UPPER + DIGITS
ALL_CASES = CORE + LOWER
REPLACE = " !\"#%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_"
IMPORT_CHARS = REPLACE + LOWER
# Visual review of the pinned archive found misleading Latin labels on these
# Greek/math and Cyrillic rasters. Label coverage alone cannot qualify them.
NON_LATIN = {
    'windows/windows-3.1/symbol-b/Symbol_10.yaff': 'Greek/math symbols labelled as Latin letters',
    'windows/windows-3.1/symbol-b/Symbol_8.yaff': 'Greek/math symbols labelled as Latin letters',
    'teletext/saa5057-cyrillic-datasheet.yaff': 'Cyrillic rasters labelled as Latin letters',
}
NON_LATIN_SOURCE_WORDS = re.compile(
    r'kanji|katakana|hiragana|japan|\bjis|\bjix|korean|chinese|hangul|hanja|'
    r'hebrew|arabic|cyrillic|russian|(?<![a-z])cyr(?:[^a-z]|$)|greek|devanagari|bengali|gurmukhi|gujarati|'
    r'oriya|tamil|telugu|kannada|malayalam|sinhala|\bthai\b|\blao\b|'
    r'tibetan|burmese|myanmar|georgian|armenian|ethiopic|\bcjk\b|'
    r'(?:^|[/_.-])jp(?:[/_.-]|$)', re.IGNORECASE,
)
NON_LATIN_ENCODINGS = {'mac-japanese', 'cp932', 'ibm-897', 'msxvidar.txt'}


def source_exclusion(path, name, family, encoding):
    """Exclude non-Latin source variants, even when they contain a Roman subset.

    Ordinary Latin faces may retain extended symbols in their original files;
    only IMPORT_CHARS can contribute to the replacement payload or gallery.
    """
    if path in NON_LATIN:
        return NON_LATIN[path]
    metadata = ' '.join((path, name, family, encoding))
    if encoding.lower() in NON_LATIN_ENCODINGS or NON_LATIN_SOURCE_WORDS.search(metadata):
        return 'Non-Latin language/source variant; Roman subset deliberately excluded'
    if any(ch.isalpha() and 'LATIN' not in unicodedata.name(ch, '') for ch in name + family):
        return 'Non-Latin source name/family; Roman subset deliberately excluded'
    return ''


def digest(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()


def cell(glyph):
    """Match the existing YAFF importer's per-glyph centering, without outline."""
    if glyph is None or glyph.width > 12 or glyph.height > 18:
        return None
    rows = [0] * 18
    ox, oy = (12 - glyph.width) // 2, (18 - glyph.height) // 2
    for y, row in enumerate(glyph.as_matrix(inklevels=(0, 1))):
        for x, bit in enumerate(row):
            if bit:
                rows[oy + y] |= 1 << (11 - ox - x)
    return rows


def fits(glyph, width=12, height=18):
    return glyph is not None and glyph.width <= width and glyph.height <= height


def ink_size(glyph):
    return tuple(glyph.bounding_box) if glyph is not None else (0, 0)


def baseline_height(glyphs):
    bounds = [g.ink_bounds for g in glyphs if g is not None and not g.is_blank()]
    return max((b.top for b in bounds), default=0) - min((b.bottom for b in bounds), default=0)


def write_candidate_list(candidates, output):
    """One representative per identical fitting replacement payload."""
    groups = collections.defaultdict(list)
    for row in candidates:
        groups[row['replacement_signature']].append(row)
    selected = []
    for group in groups.values():
        group.sort(key=lambda r: (r['all_glyphs_fit'] not in (True, 'True'), r['path']))
        selected.append({**group[0], 'equivalent_source_paths': json.dumps([r['path'] for r in group], ensure_ascii=False)})
    selected.sort(key=lambda r: r['path'])
    with (output / 'library-candidates.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(selected[0]))
        writer.writeheader()
        writer.writerows(selected)


def existing_signatures():
    signatures = collections.defaultdict(list)
    for manifest_path in sorted((ROOT / 'fonts').glob('manifest-*.json')):
        library = manifest_path.stem.removeprefix('manifest-')
        # The Hoard import must not count as a pre-existing match to itself.
        if library in ('emoji-pixels', 'hoard'):
            continue
        for entry in json.loads(manifest_path.read_text(encoding='utf-8-sig')):
            font = json.loads((ROOT / 'fonts/data' / library / entry['file']).read_text(encoding='utf-8-sig'))
            masks = []
            for ch in CORE:
                glyph = font.get('glyphs', {}).get(f'U+{ord(ch):04X}')
                rows = [0] * 18
                if glyph:
                    w, h = glyph['size']
                    ox, oy = glyph['offset']
                    for y, row in enumerate(glyph['rows'][:h]):
                        for x in range(w):
                            if row & (1 << (w - 1 - x)) and 0 <= x + ox < 12 and 0 <= y + oy < 18:
                                rows[y + oy] |= 1 << (11 - x - ox)
                masks.append(rows if any(rows) else None)
            if all(masks):
                signatures[digest(masks)].append(f'{library}/{entry["file"]}')
    return signatures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/hoard-font-audit')
    parser.add_argument('--python-packages', type=Path, default=ROOT / 'tools/hoard-audit/python')
    args = parser.parse_args()
    if args.python_packages.exists():
        sys.path.insert(0, str(args.python_packages))
    import monobit
    from PIL import Image, ImageDraw

    args.output.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger()
    logger.setLevel(logging.WARNING)
    logger.handlers.clear()
    logger.addHandler(logging.FileHandler(args.output / 'parser.log', mode='w', encoding='utf-8'))
    existing = existing_signatures()
    # Run the actual website importer too, rather than approximate its syntax support.
    node_code = """
import {parseYaffToOverlay} from './js/modules/yaff.js';
import {createInterface} from 'node:readline';
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
for await (const line of createInterface({input: process.stdin, crlfDelay: Infinity})) {
  const font = parseYaffToOverlay(JSON.parse(line));
  const missing = [...chars].filter(ch => !font.glyphs[`U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')}`]?.rows.some(Boolean));
  console.log(JSON.stringify({missing: missing.join(''), stats: font._importStats}));
}
"""
    importer = subprocess.Popen(['node', '--input-type=module', '-e', node_code], cwd=ROOT,
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
    records, errors, gallery = [], [], []
    with zipfile.ZipFile(args.archive) as archive:
        members = sorted(n for n in archive.namelist() if n.endswith(('.yaff', '.draw')))
        commit = members[0].split('/')[0].removeprefix('hoard-of-bitfonts-')
        for file_index, member in enumerate(members):
            relative = member.split('/', 1)[1]
            data = archive.read(member)
            current = None
            if member.endswith('.yaff'):
                importer.stdin.write(json.dumps(data.decode('utf-8-sig')) + '\n')
                importer.stdin.flush()
                current = json.loads(importer.stdout.readline())
            try:
                # Historical .draw files have native indices, not reliably Unicode.
                kwargs = {'format': 'yaff'} if member.endswith('.yaff') else {'format': 'hexdraw', 'unicode': False}
                fonts = monobit.load(io.BufferedReader(io.BytesIO(data)), **kwargs)
                for face_index, original in enumerate(fonts):
                    font = original.label() if original.encoding else original
                    glyphs = {ch: font.get_glyph(char=ch, missing=None) for ch in IMPORT_CHARS}
                    native = {ch: original.get_glyph(codepoint=ord(ch), missing=None) for ch in CORE}
                    present = lambda ch: glyphs[ch] is not None and not glyphs[ch].is_blank()
                    missing_core = ''.join(ch for ch in CORE if not present(ch))
                    oversized_core = ''.join(ch for ch in CORE if present(ch) and not fits(glyphs[ch]))
                    oversized_all = [g for g in font.glyphs if not fits(g)]
                    exclusion = source_exclusion(relative, str(font.name), str(font.family), str(font.encoding))
                    compatible = not missing_core and not oversized_core and not exclusion
                    missing_lower = ''.join(ch for ch in LOWER if not present(ch))
                    oversized_lower = ''.join(ch for ch in LOWER if present(ch) and not fits(glyphs[ch]))
                    core_masks = [cell(glyphs[ch]) for ch in CORE] if compatible else []
                    max_ink_w = max((ink_size(glyphs[ch])[0] for ch in CORE), default=0)
                    max_ink_h = max((ink_size(glyphs[ch])[1] for ch in CORE), default=0)
                    common_height = baseline_height(glyphs[ch] for ch in CORE)
                    signature = digest(core_masks) if compatible else ''
                    status = 'non-latin-source' if exclusion else 'missing-alphanumeric' if missing_core else 'oversized-alphanumeric' if oversized_core else 'candidate'
                    row = {
                        'path': relative, 'face': face_index, 'format': member.rsplit('.', 1)[-1],
                        'name': str(font.name), 'family': str(font.family), 'encoding': str(font.encoding),
                        'status': status, 'glyphs': len(font.glyphs),
                        'source_exclusion': exclusion,
                        'unmapped_needs_review': bool(missing_core) and not font.encoding,
                        'native_ascii_positions_fit_unverified': all(
                            fits(native[ch]) and not native[ch].is_blank() for ch in CORE
                        ) and not compatible and not exclusion,
                        'missing_upper_digits': missing_core, 'oversized_upper_digits': oversized_core,
                        'missing_lowercase': missing_lower, 'oversized_lowercase': oversized_lower,
                        'full_lowercase_fits': compatible and not missing_lower and not oversized_lower,
                        'max_core_raster_width': max((glyphs[ch].width for ch in CORE if present(ch)), default=0),
                        'max_core_raster_height': max((glyphs[ch].height for ch in CORE if present(ch)), default=0),
                        'max_core_ink_width': max_ink_w, 'max_core_ink_height': max_ink_h,
                        'core_baseline_ink_height': common_height,
                        'core_ink_fits_after_padding_trim': not exclusion and not missing_core and max_ink_w <= 12 and max_ink_h <= 18,
                        'core_fits_with_outline_margin': compatible and max_ink_w <= 10 and common_height <= 16,
                        'all_glyphs_fit': not oversized_all, 'oversized_glyph_count': len(oversized_all),
                        'unique_upper_shapes': len({digest(cell(glyphs[ch])) for ch in UPPER if present(ch) and fits(glyphs[ch])}),
                        'unique_digit_shapes': len({digest(cell(glyphs[ch])) for ch in DIGITS if present(ch) and fits(glyphs[ch])}),
                        'missing_replaceable_punctuation': ''.join(ch for ch in REPLACE if ch != ' ' and ch not in CORE and not present(ch)),
                        'oversized_replaceable_punctuation': ''.join(ch for ch in REPLACE if present(ch) and not fits(glyphs[ch])),
                        'current_importer_core_fits': not current['missing'] if current else False,
                        'core_signature': signature,
                        'replacement_signature': digest([cell(glyphs[ch]) for ch in IMPORT_CHARS]) if compatible else '',
                        'existing_core_matches': '|'.join(existing.get(signature, [])),
                    }
                    records.append(row)
                    if compatible:
                        gallery.append((row, {ch: cell(glyphs[ch]) for ch in ALL_CASES}))
            except Exception as error:
                errors.append({'path': relative, 'error': repr(error)})
            if (file_index + 1) % 100 == 0:
                print(f'{file_index + 1}/{len(members)} files, {len(gallery)} candidates', flush=True)
    importer.stdin.close()
    if importer.wait() != 0:
        raise RuntimeError('Website importer subprocess failed')

    with (args.output / 'fonts.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)
    candidates = [r for r in records if r['status'] == 'candidate']
    write_candidate_list(candidates, args.output)
    groups = collections.defaultdict(list)
    for row in candidates:
        groups[row['core_signature']].append(row['path'])
    summary = {
        'repository': 'https://github.com/robhagemans/hoard-of-bitfonts', 'commit': commit,
        'archive_sha256': hashlib.sha256(args.archive.read_bytes()).hexdigest(),
        'selection_policy': 'Latin source faces only; non-Latin language variants excluded even when a Roman subset fits',
        'replacement_characters': IMPORT_CHARS,
        'monobit_version': monobit.__version__,
        'files': dict(collections.Counter(r['format'] for r in records)),
        'faces': len(records), 'parse_errors': errors,
        'statuses': dict(collections.Counter(r['status'] for r in records)),
        'candidates_with_lowercase': sum(r['full_lowercase_fits'] for r in candidates),
        'candidates_all_glyphs_fit': sum(r['all_glyphs_fit'] for r in candidates),
        'unique_replacement_payloads_all_glyphs_fit': len({r['replacement_signature'] for r in candidates if r['all_glyphs_fit']}),
        'candidates_baseline_height_fits': sum(r['core_baseline_ink_height'] <= 18 for r in candidates),
        'candidates_outline_margin': sum(r['core_fits_with_outline_margin'] for r in candidates),
        'unique_core_designs': len(groups),
        'unique_replacement_payloads': len({r['replacement_signature'] for r in candidates}),
        'existing_core_match_faces': sum(bool(r['existing_core_matches']) for r in candidates),
        'unique_core_designs_without_existing_match': len({r['core_signature'] for r in candidates if not r['existing_core_matches']}),
        'current_importer_qualifying_files': sum(r['current_importer_core_fits'] for r in records),
        'current_importer_unconfirmed_or_incompatible': sum(r['current_importer_core_fits'] and r['status'] != 'candidate' for r in records),
        'candidates_needing_importer_improvements': sum(not r['current_importer_core_fits'] for r in candidates),
        'additional_candidates_if_padding_trimmed': sum(r['status'] == 'oversized-alphanumeric' and r['core_ink_fits_after_padding_trim'] for r in records),
        'missing_coverage_without_declared_encoding': sum(r['unmapped_needs_review'] for r in records),
        'unverified_native_ascii_fitting_files': sum(r['native_ascii_positions_fit_unverified'] for r in records),
        'by_source': {source: {
            'total': sum(r['path'].split('/')[0] == source for r in records),
            'candidates': sum(r['path'].split('/')[0] == source for r in candidates),
            'lowercase': sum(r['path'].split('/')[0] == source and r['full_lowercase_fits'] for r in candidates),
        } for source in sorted({r['path'].split('/')[0] for r in records})},
    }
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    (args.output / 'duplicates.json').write_text(json.dumps([v for v in groups.values() if len(v) > 1], indent=2) + '\n', encoding='utf-8')

    # Static, self-contained review gallery: the actual candidate masks, no AI images.
    cards = []
    import base64
    for row, masks in gallery:
        image = Image.new('RGB', (len(CORE) * 13, 40), '#15202b')
        draw = ImageDraw.Draw(image)
        for line, text in enumerate((CORE, LOWER)):
            for index, ch in enumerate(text):
                for y, bits in enumerate(masks[ch] or []):
                    for x in range(12):
                        if bits & (1 << (11 - x)):
                            draw.point((index * 13 + x, line * 20 + y), fill='#f2f5f7')
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        src = base64.b64encode(buffer.getvalue()).decode('ascii')
        path = html.escape(row['path'])
        label = html.escape(row['name'])
        cards.append(f'<article><h2>{label}</h2><p>{path}</p><img loading="lazy" width="936" height="80" src="data:image/png;base64,{src}" alt="Uppercase letters, digits and available lowercase"><p>Lowercase: {row["full_lowercase_fits"]}; all glyphs fit: {row["all_glyphs_fit"]}; existing A–Z/0–9 match: {bool(row["existing_core_matches"])}</p></article>')
    page = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Latin hoard font candidates</title><style>body{background:#0d141b;color:#f2f5f7;font:15px system-ui;margin:24px}article{padding:16px 0;border-top:1px solid #456}h2{font-size:18px;margin:0}p{color:#b8c7d4}img{image-rendering:pixelated;max-width:100%;height:auto}</style><h1>Latin hoard font candidates</h1><p>Latin source faces only: Japanese/CJK and other non-Latin language variants are excluded even when they contain Roman letters. All candidates have nonblank A–Z and 0–9 bitmaps fitting 12×18. Glyphs are centered as in the current importer. Lowercase below is included where it fits. No scaling or outline is applied to the source masks.</p>' + ''.join(cards) + '</html>\n'
    (args.output / 'gallery.html').write_text(page, encoding='utf-8')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
