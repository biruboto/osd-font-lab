"""Baseline regressions: python -m unittest discover -s tests -p hoard_import_test.py."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('hoard_import', ROOT / 'scripts/import-hoard-fonts.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def glyph(rows, shift=0):
    width, height = len(rows[0]), len(rows)
    points = [(x, height - 1 - y + shift) for y, row in enumerate(rows) for x, bit in enumerate(row) if bit == '@']
    return {
        'width': width, 'height': height, 'advance': width, 'left': 0, 'shift': shift,
        'rows': [int(row.replace('@', '1').replace('.', '0'), 2) for row in rows],
        'bounds': [min(x for x, y in points), min(y for x, y in points),
                   max(x for x, y in points) + 1, max(y for x, y in points) + 1],
    }


class BaselineTests(unittest.TestCase):
    def test_approved_curation_keeps_330_and_preserves_all_52_variant_sources(self):
        selection = json.loads((ROOT / 'fonts/hoard-curation.json').read_text(encoding='utf-8'))
        manifest = json.loads((ROOT / 'fonts/manifest-hoard.json').read_text(encoding='utf-8'))
        removed = {member['file']: group['reference'] for group in selection['groups']
                   for member in group['members'] if member['file'] != group['reference']}
        self.assertEqual(len(manifest), selection['outputCount'])
        self.assertEqual(len(manifest), 330)
        self.assertEqual(len(removed), 52)
        self.assertEqual({entry['file'] for entry in manifest}, set(selection['eligibleFiles']) - removed.keys())
        aliases = {}
        for entry in manifest:
            font = json.loads((ROOT / 'fonts/data/hoard' / entry['file']).read_text(encoding='utf-8'))
            for variant in font['_source'].get('variants', []):
                self.assertEqual(removed[variant['file']], entry['file'])
                self.assertIn('properties', variant['source'])
                self.assertTrue(variant['source']['path'])
                self.assertEqual(variant['source']['commit'], font['_source']['commit'])
                self.assertNotIn(variant['file'], aliases)
                aliases[variant['file']] = variant
        self.assertEqual(set(aliases), removed.keys())
        self.assertEqual({path.name for path in (ROOT / 'fonts/data/hoard').glob('*.json')}, {entry['file'] for entry in manifest})
        self.assertEqual(sum(entry['name'] == 'Windows 2.03 · Terminal 12 — 8x12' for entry in manifest), 1)
        self.assertEqual([entry['name'] for entry in manifest if 'P0T-' in entry['name']], ['Amiga · P0T-Ibm Regular 8x8 — 8x8'])

    def test_system_names_follow_platform_folders_not_family_or_author_folders(self):
        examples = [
            ('apple/mac/Geneva_9.yaff', 'Geneva 9', 'Apple Macintosh · Geneva 9'),
            ('apple/iigs/Geneva_9.yaff', 'Geneva 9', 'Apple IIgs · Geneva 9'),
            ('apple/ii/apple-iic.yaff', 'Apple IIe Enhanced', 'Apple IIe Enhanced'),
            ('atari/st/atari-st-8x8.yaff', '8x8 system font', 'Atari ST · 8x8 system font'),
            ('atari/8-bit/atascii.yaff', 'Atari Classic 8x8', 'Atari 8-bit · Classic 8x8'),
            ('next/Courier/Courier_12.yaff', 'Courier 12', 'NeXT · Courier 12'),
            ('windows/windows-3.1/arial-b/Arial_8.yaff', 'Arial 8', 'Windows 3.1 · Arial 8'),
            ('os-2/os2_warp4/pcomos2/IBM3270_4x6.yaff', 'IBM3270', 'OS/2 Warp 4 · IBM3270'),
            ('amiga/amiga-ks10-topaz-08.yaff', 'topaz/8', 'Amiga Kickstart 1.0 · topaz/8'),
            ('amiga/workbench-3.1/Courier_13.yaff', 'Courier Regular 13', 'Amiga Workbench 3.1 · Courier Regular 13'),
            ('|custom|/amiga/nudelfonts/PolarSmall-Prop.yaff', '$VER: PolarSmall-Prop6 39.0 (18.', 'Amiga · PolarSmall-Prop'),
            ('|custom|/amstrad_setfont/setfont-bold.yaff', 'Bold Regular 8', 'Amstrad PCW · Bold Regular 8'),
            ('kyotronic/trs80-dvi-7x8.yaff', 'M17-Cg Regular 8', 'TRS-80 Disk/Video Interface · M17-Cg Regular 8'),
            ('oberon/Oberon9m.screen.yaff', 'Oberon9m.Scn.Fnt', 'Oberon9m.Scn.Fnt'),
            ('acorn/bbc/bbc_master.yaff', 'Acorn BBC Master', 'Acorn BBC Master'),
        ]
        for path, name, expected in examples:
            with self.subTest(path=path):
                self.assertEqual(importer.library_name(name, {'source_name': 'PolarSmall-Prop.font'}, path), expected)

    def test_every_library_label_includes_its_source_system(self):
        manifest = json.loads((ROOT / 'fonts/manifest-hoard.json').read_text(encoding='utf-8'))
        for entry in manifest:
            source = json.loads((ROOT / 'fonts/data/hoard' / entry['file']).read_text(encoding='utf-8'))['_source']
            with self.subTest(path=source['path']):
                self.assertIn(importer.source_system(source['path']).casefold(), entry['name'].casefold())

    def test_non_latin_source_variants_stay_excluded_even_with_roman_letters(self):
        for path, name, encoding in [
            ('apple/kanjitalk/font.yaff', 'Mincho', 'mac-japanese'),
            ('msx/msx-russian.yaff', 'MSX2 Russian', ''),
            ('elan_enterprise/ep_cyr_vs.yaff', 'Elan Enterprise', ''),
        ]:
            self.assertTrue(importer.audit.source_exclusion(path, name, '', encoding))
        self.assertFalse(importer.audit.source_exclusion('amiga/topaz.yaff', 'Topaz 8', '', 'iso8859-1'))

    def test_raw_box_and_metric_font_share_standing_line_and_keep_descenders(self):
        letters = {'H': ['@..@', '@..@', '@@@@', '@..@', '....'],
                   'g': ['.@@.', '@..@', '.@@@', '...@', '.@@.']}
        fonts = []
        for shift in (0, -1):
            gs = {ch: glyph(rows, shift) for ch, rows in letters.items()}
            fonts.append({'size': [4, 5], 'glyphs': gs, 'anchor': importer.lettering_baseline(gs)})
        baseline = importer.plan_groups(fonts)[importer.group_key(fonts[0])]['baseline']
        outputs = []
        for font in fonts:
            converted = {ch: importer.convert_glyph(g, font['anchor'], baseline) for ch, g in font['glyphs'].items()}
            self.assertEqual(converted['H']['offset'][1] + converted['H']['size'][1], baseline)
            self.assertEqual(converted['g']['offset'][1] + converted['g']['size'][1], baseline + 1)
            outputs.append(converted)
        self.assertEqual(outputs[0], outputs[1], 'Changing only the native coordinate origin must not move the imported font')

    def test_fonts_that_cannot_keep_strokes_at_the_body_baseline_are_culled(self):
        tall = glyph(['@'] * 17)
        descending = glyph(['@'] * 20, -13)
        fonts = [{'size': [1, 17], 'anchor': 0, 'glyphs': {'H': tall}, 'audit': {'path': 'tall'}, 'name': 'tall'},
                 {'size': [1, 7], 'anchor': 0, 'glyphs': {'H': glyph(['@'] * 7), 'g': descending}, 'audit': {'path': 'descending'}, 'name': 'descending'}]
        kept, excluded = importer.select_sources(fonts, importer.plan_groups(fonts))
        self.assertEqual(kept, [])
        self.assertEqual(len(excluded), 2)

    def test_source_padding_does_not_raise_seven_pixel_capitals(self):
        rows = ['@..@'] * 7
        fonts = [
            {'size': [4, 8], 'anchor': 0, 'glyphs': {'H': glyph(rows + ['....'], -1)}},
            {'size': [4, 9], 'anchor': 0, 'glyphs': {'H': glyph(rows + ['....', '....'], -2)}},
        ]
        plans = importer.plan_groups(fonts)
        self.assertEqual(plans[(4, 8, 7)]['baseline'], 12)
        self.assertEqual(plans[(4, 9, 7)]['baseline'], 12)
        for font in fonts:
            g = importer.convert_glyph(font['glyphs']['H'], 0, 12)
            self.assertEqual(g['offset'][1], 5)

    def test_different_capital_heights_in_one_source_size_are_not_averaged(self):
        fonts = [
            {'size': [8, 8], 'anchor': 0, 'glyphs': {'H': glyph(['@'] * 7 + ['.'], -1)}},
            {'size': [8, 8], 'anchor': 0, 'glyphs': {'H': glyph(['@'] * 8)}},
        ]
        plans = importer.plan_groups(fonts)
        self.assertEqual(plans[(8, 8, 7)]['baseline'], 12)
        self.assertEqual(plans[(8, 8, 8)]['baseline'], 13)
        for font in fonts:
            baseline = plans[importer.group_key(font)]['baseline']
            g = importer.convert_glyph(font['glyphs']['H'], 0, baseline)
            self.assertEqual(g['offset'][1], 5)

    def test_wide_ink_is_rejected_instead_of_losing_horizontal_stroke(self):
        self.assertIsNone(importer.convert_glyph(glyph(['@' * 11] * 7), 0, 12))
        converted = importer.convert_glyph(glyph(['@' * 10] * 7), 0, 12)
        self.assertEqual(converted['offset'][0], 1)

    def test_punctuation_outlier_culls_face_without_moving_the_shared_baseline(self):
        good = {'size': [4, 8], 'anchor': 0, 'glyphs': {'H': glyph(['@..@'] * 7)},
                'audit': {'path': 'good'}, 'name': 'good'}
        bad = {**good, 'glyphs': {**good['glyphs'], '^': glyph(['@'], 17)},
               'audit': {'path': 'bad'}, 'name': 'bad'}
        plans = importer.plan_groups([good, bad])
        self.assertEqual(plans[(4, 8, 7)]['baseline'], 12)
        kept, excluded = importer.select_sources([good, bad], plans)
        self.assertEqual([f['name'] for f in kept], ['good'])
        self.assertIn('^', excluded[0]['glyphs'])

    def test_outlying_punctuation_is_omitted_without_changing_its_shape(self):
        self.assertIsNone(importer.convert_glyph(glyph(['@'] * 5, 14), 0, 12))

    def test_imported_library_is_latin_and_all_letters_fit_shared_size_baselines(self):
        manifest = json.loads((ROOT / 'fonts/manifest-hoard.json').read_text(encoding='utf-8'))
        report = json.loads((ROOT / 'docs/hoard-font-import/layout.json').read_text(encoding='utf-8'))
        self.assertEqual(len(manifest), report['fontCount'])
        self.assertGreater(len(manifest), 0)
        self.assertLess(len(manifest), 497)
        baselines = {}
        for entry in manifest:
            font = json.loads((ROOT / 'fonts/data/hoard' / entry['file']).read_text(encoding='utf-8'))
            layout, source = font['_layout'], font['_source']
            self.assertFalse(importer.audit.source_exclusion(source['path'], source['name'], source['properties'].get('family', ''), source['properties'].get('encoding', '')))
            for alias in source['equivalentAuditSources']:
                self.assertFalse(importer.audit.source_exclusion(alias, '', '', ''))
            size = (*layout['sourceBitmapSize'], layout['groupCapitalHeight'])
            self.assertEqual(baselines.setdefault(size, layout['baseline']), layout['baseline'])
            for key, g in font['glyphs'].items():
                self.assertIn(chr(int(key[2:], 16)), importer.audit.IMPORT_CHARS)
                x, y = g['offset']
                w, h = g['size']
                self.assertTrue(1 <= x < x + w <= 11 and 1 <= y < y + h <= 17, entry['file'])
                self.assertEqual(len(g['rows']), h)
                self.assertTrue(all(0 <= row < (1 << w) for row in g['rows']))
            for ch in importer.audit.CORE:
                self.assertTrue(any(font['glyphs'][f'U+{ord(ch):04X}']['rows']))
            standing_lines = [font['glyphs'][f'U+{ord(ch):04X}']['offset'][1] + font['glyphs'][f'U+{ord(ch):04X}']['size'][1] for ch in importer.FLAT_CAPITALS]
            self.assertEqual(sorted(standing_lines)[len(standing_lines) // 2], layout['baseline'])
            self.assertEqual(layout['baseline'], (18 + layout['groupCapitalHeight']) // 2)
            cap_height = sorted(font['glyphs'][f'U+{ord(ch):04X}']['size'][1] for ch in importer.FLAT_CAPITALS)[len(importer.FLAT_CAPITALS) // 2]
            capital_top = sorted(font['glyphs'][f'U+{ord(ch):04X}']['offset'][1] for ch in importer.FLAT_CAPITALS)[len(importer.FLAT_CAPITALS) // 2]
            self.assertEqual(capital_top, (18 - cap_height) // 2, entry['name'])
            if source['name'] == 'Oberon9m.Scn.Fnt':
                self.assertEqual(font['glyphs']['U+0048']['offset'][1], 5)
                self.assertEqual(layout['baseline'], 12)
        self.assertEqual(len(baselines), len(report['sizeGroups']))
        self.assertEqual(baselines[(8, 8, 7)], 12)


if __name__ == '__main__':
    unittest.main()
