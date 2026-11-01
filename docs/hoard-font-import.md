# Hoard of Bitfonts library

The audited Latin candidates are converted into the existing `cell` / `glyphs`
JSON format and registered as **Hoard of Bitfonts**. Select that
library in the Fonts panel to try them in the sheet, editor, and HUD.

Picker names include the source system from the upstream folders, for example
`Apple Macintosh · Geneva Regular 9` or `Windows 3.1 · Arial 8`, followed by the
source bitmap size. Platform and OS versions distinguish otherwise identical
family names. Custom collections use their target system rather than the
contributor folder, and names that already identify the system are kept without
repeating it. Original source names and paths remain in `_source` metadata.

There are **330 curated entries** across **125 source-size/capital-height groups**.
The original pool contains 497 candidates; **115 are excluded** because at least
one supplied glyph cannot retain a full one-pixel outline at its intended placement,
and **52 close variants are consolidated** from the remaining 382 stroke-safe faces.
**All fonts with seven-pixel capitals share baseline 12** (the row boundary immediately
below row 11), regardless of the source cell dimensions. All 330 retained glyph
payloads are distinct. Original metadata for the 52 consolidated variants is
preserved under their representatives' `_source.variants` fields.

- [Comparison gallery rendered from imported JSON](hoard-font-import/gallery.html)
- [Oberon before/after beside BBC Master and Topaz](hoard-font-import/alignment-before-after.png)
- [Per-font layout, exclusions, and omitted-glyph report](hoard-font-import/layout.json)
- [Excluded candidates and per-glyph reasons](hoard-font-import/excluded.csv)
- [Consolidated variants and their retained representatives](hoard-font-import/consolidated.csv)
- [Approved curation groups](../fonts/hoard-curation.json)
- [Picker manifest](../fonts/manifest-hoard.json)
- [Generator](../scripts/import-hoard-fonts.py)
- [Near-duplicate visual review](hoard-font-import/near-duplicates.html)
- [Near-duplicate groups and exact pixel differences](hoard-font-import/near-duplicates.json)

## Baseline placement

Each face is placed using **its own visible capital height**, measured as the
median height of its flat-bottom reference capitals. Fonts sharing a visible
capital height share the same baseline, even if their source cell dimensions
differ. Source-size labels alone are insufficient: two 8×8 boxes can hold
different visible letter sizes.

Placement uses the actual capital body instead of the padded source rectangle.
For a capital height `h`, the baseline is `floor((18 + h) / 2)`. Groups whose
typical capitals are seven pixels tall therefore use baseline 12, regardless of
whether they are stored as 8×8, 7×9, or another source size. This corrects the
former Oberon9m 7×9 placement: its H moves from rows 4–10 to rows 5–11, matching
BBC Master and Topaz's seven-pixel capitals.

An additional full-library check found 40 one-pixel-high outliers when capital
heights were averaged across source-size groups. The generator now avoids that
averaging entirely. Every retained face's reference-capital body is checked
against `floor((18 - h) / 2)` for its top row; all 330 retained entries pass exactly.

Source `shift-up`, bearings, and raster positions establish each glyph's original
coordinates. Flat-bottom capitals H/E/I/L/M/N/T/X/Z identify the font's standing
line. The median standing line corrects a common source origin/padding offset;
all glyphs receive the same correction. This matters for ROM fonts with no
baseline metadata and for fonts whose metadata places the baseline at the bottom
of a padded cell instead of under the letters.

The generator does not independently move g/j/p/q/y, punctuation, short capitals,
or ascenders. Their distance from the standing line is preserved exactly. Blank
padding may be removed from stored glyph rectangles; no ink is removed. Source
bitmaps are never scaled. The JSON carries both the original standing-line
coordinate and the shared output baseline for inspection.

The baseline is never shifted to rescue an oversized ascender, descender, or
punctuation mark. Instead, **every supplied nonblank replacement glyph** must fit
inside the **10×16 ink interior**: columns 1–10 and rows 1–16 of the 12×18 cell.
This leaves one pixel on every side for either the 4-neighbor or 8-neighbor stroke.
If any supplied Latin letter, digit, or supported punctuation cannot meet this
rule, the **entire candidate is excluded**, with per-glyph reasons recorded in
the layout report. Source bitmap padding alone does not disqualify a font when
its actual ink fits. No glyph is scaled or clipped to rescue a candidate.

Originally missing glyphs continue to use the base font. One supplied blank
punctuation slot is omitted rather than blanking the base glyph; a supported
space is explicitly blank. No glyph is omitted to work around a stroke fit failure.

The retained import uses source metrics for 255 candidates and infers a standing
line for 75 ROM-style candidates. Sixty-two metric-bearing sources also require
a common standing-line origin correction. Every retained glyph keeps its original
ascender/descender relationships.

## Rebuilding and checking

```powershell
python scripts/import-hoard-fonts.py
python scripts/build-font-previews.py --check
python -m unittest discover -s tests -p hoard_import_test.py -v
npm test
python -m unittest discover -s tests -p browser_test.py -k test_hoard_library -v
```

The generator reads the pinned archive directly and verifies its SHA-256 against
the audit. It refuses excluded source variants. Generated files retain original
metadata and source paths; stale files from an earlier selection are
removed only when their provenance identifies this same upstream collection.
The approved `fonts/hoard-curation.json` selection is applied on every rebuild,
so the 52 consolidated entries do not reappear. It validates the complete input
set and all pairwise similarity limits before applying the fixed groups; it does
not repeatedly merge the reduced catalog into progressively larger groups.

An independent pixel comparison of the **28,812 retained glyphs** against source
rasters verifies every ink pixel and exact vertical relationships. A regression test renders every
retained glyph with the application's real 4-neighbor and 8-neighbor stroke
functions on a padded canvas, proving that no outline pixels extend outside the
OSD cell. Browser coverage switches between Acorn BBC Master, Amiga Topaz 8×8,
and Oberon9m 7×9, checking their matching capital placement and lowercase descenders.

The gallery now shows the actual 4-neighbor outline, complete 12×18 cell
backgrounds, and a baseline guide so both placement and border clearance can be
reviewed directly.

## Duplicate review

The approved selection reduces **382 stroke-safe entries to 330 default styles**.
The original side-by-side report preserves the full 382-entry comparison for
reference. `python scripts/review-hoard-duplicates.py` can generate a fresh review
of the current catalog without changing the library; the approved curation is
stored separately and remains fixed.

- Comparing every rendered character exactly leaves 374 sets.
- Comparing A–Z/a–z/0–9 exactly, including positions, leaves 347 sets.
- Ignoring only horizontal positioning differences leaves 339 letterform sets.
- A conservative near-duplicate pass proposes 330 groups, including singletons.

The near-duplicate threshold permits at most two changed alphanumeric glyphs,
eight changed ink pixel positions in total, and six in any one glyph. Coverage
must match. Every pair in a group must satisfy the limit; similarity chains
cannot merge progressively different fonts. Punctuation differences are displayed
for review but do not define a separate alphanumeric lettering style. Different
weights or materially different letterforms remain separate.

For example, P0T-IBM and P0T-NOoDLE have identical alphanumeric pixels; only `-`
and `=` differ. P0T-Prop uses the same alphanumeric letterforms with some
horizontal positioning differences. The three Terminal 12 8×12 sources differ
only in `0` and/or `8`. They fit the proposed near-duplicate grouping.

The first row of each approved group is retained, using a deterministic choice
that favors fuller glyph coverage and then stable name/file order. Terminal 12
8×12 retains the Windows 2.03 reference with the diagonal-marked zero; P0T-Ibm
represents the IBM/NOoDLE/Prop group. Alternate source metadata and the exact
differences remain recorded with each representative and in `consolidated.csv`.
The retained bitmaps, baselines, and outlines are unchanged by curation.
