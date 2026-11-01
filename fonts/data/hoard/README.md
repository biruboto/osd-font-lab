# Hoard of Bitfonts

Select **Hoard of Bitfonts** in Font Lab's library picker.

These JSON files come from the Latin-only candidate audit of
[hoard-of-bitfonts](https://github.com/robhagemans/hoard-of-bitfonts), commit
`240a23ec828810504b45e6d9b0c5bd8065ab5d5c`. Only Latin A–Z/a–z, digits, and
Font Lab's supported ASCII punctuation are converted. Japanese/CJK and other
identified non-Latin source variants are excluded.

Regenerate with `python scripts/import-hoard-fonts.py`, using the ignored local
archive and monobit installation described in [the audit](../../../docs/hoard-font-audit.md).
`python scripts/build-font-previews.py --check` checks the picker catalog.

The import preserves monochrome ink without resizing. Fonts with the same visible
capital height share one standing baseline in the 12×18 OSD cell. Source metrics
preserve all internal vertical relationships. A source's common padding/origin
offset is normalized against flat-bottom capitals; ROM fonts without baseline
metrics use those same letters to infer it. Ascenders and descenders move with
the entire font. Proportional side bearings are respected within fixed OSD cells.
Placement centers each face's actual visible capital height, rather than the
padded source box or a group average; matching seven-pixel capitals therefore
sit on baseline 12 in both 8×8 and 7×9 source boxes.

All supplied nonblank replacement glyphs must leave a complete one-pixel border
for either stroke style: actual ink stays in the 10×16 interior of the 12×18
cell. A candidate with any letter or supported punctuation that fails this rule
is excluded as a whole. Of 497 candidates, 382 pass these geometry checks; the
approved curation retains one representative per style group, for 330 entries.

Each JSON retains its source path, source name, original descriptive properties,
and layout diagnostics in `_source` / `_layout`. The source standing-line value
is an upward coordinate; the output baseline is a downward row boundary. These
fields are for provenance and rebuilding; the application uses the standard
`cell` and `glyphs` overlay structure.
Amiga `$VER:` version headers are cleaned out of picker names; the original
version/date strings remain in `_source` for attribution and rebuilding.
Metadata for 52 consolidated variants is retained in `_source.variants`, including
their original source properties and differences. The fixed selection in
`fonts/hoard-curation.json` is reapplied on rebuild so variants stay consolidated.

See the [baseline comparison gallery](../../../docs/hoard-font-import/gallery.html)
and [layout report](../../../docs/hoard-font-import/layout.json) for review.
Excluded fonts and per-glyph reasons are recorded; glyphs are never clipped or
scaled to make a font fit. The gallery includes the actual outline for review.

Upstream does not provide one blanket font license. Its
[licensing notes](https://github.com/robhagemans/hoard-of-bitfonts/blob/240a23ec828810504b45e6d9b0c5bd8065ab5d5c/LICENSE.md)
refer to individual sources and directories for explicit terms. Original
copyright/notice properties are preserved where supplied.
