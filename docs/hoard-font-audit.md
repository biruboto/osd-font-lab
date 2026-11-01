# Hoard of Bitfonts compatibility audit

Audited 2026-10-31 against OSD Font Lab commit `78ce08d`, using
[hoard-of-bitfonts commit `240a23ec828810504b45e6d9b0c5bd8065ab5d5c`](https://github.com/robhagemans/hoard-of-bitfonts/tree/240a23ec828810504b45e6d9b0c5bd8065ab5d5c)
(2026-09-15).

**775 Latin source fonts qualify for a lettering library. After
removing identical replacement sets, they produce 497 entries.** These are
conservative candidate counts; unverified native character mappings are not
included. The live application and its import controls were not changed.

A later [curated import](hoard-font-import.md) converts these candidates to
JSON and adds a selectable library with shared baselines. The centered output
counts in this audit describe its initial eligibility/deduplication pass;
baseline normalization is documented separately. The current import further
retains **330 entries**: 115 candidates are excluded to reserve a complete outline
border, and 52 close variants are consolidated from the remaining 382. These
stricter checks do not change the original raw audit totals.

## What qualifies

- All 26 Latin uppercase letters A–Z and all ten digits 0–9 must exist and contain ink.
- Every required character's stored bitmap must fit the app's **12×18** cell.
  No resizing, clipping, or trimming is used to qualify a font.
- Unicode labels or a declared character encoding must identify the characters.
  Native machine indices are not automatically interpreted as Unicode/ASCII.
- Japanese/CJK and other clearly identified non-Latin language/source variants
  are excluded entirely, even when they contain a complete Roman subset. The
  source filter checks names, families, paths, and encodings. This removes the
  Japanese KanjiTalk, MSX/NEC Japanese, and Katakana entries that appeared in the
  initial gallery, as well as Hebrew, Arabic, Korean, and Russian/Cyrillic source variants (including abbreviated `cyr` names).
- Replacement payloads contain only ASCII Latin letters, digits, and Font Lab's
  supported punctuation. Non-Latin characters elsewhere in an ordinary Latin
  source font are never included in a replacement set or preview.
- Three visually identified fonts with misleading Latin labels are excluded:
  Windows 3.1 `Symbol_8` and `Symbol_10` actually contain Greek/math lettering;
  `saa5057-cyrillic-datasheet` contains Cyrillic lettering.
- Lowercase and punctuation are measured separately. Fonts without lowercase
  can still be useful in Font Lab's uppercase mode.

## Counts

| Filter | Source fonts |
| --- | ---: |
| All font files inspected | 2,251 |
| YAFF files | 2,138 |
| Legacy `.draw` files | 113 |
| Latin sources with confirmed A–Z and 0–9 fitting 12×18 | **775** |
| Above, with all a–z also fitting | **751** |
| Above, with every glyph in the entire source font fitting | **675** |
| Above, with room for a one-pixel outline after positioning the ink | **627** |

All 775 qualifying fonts also fit within an 18-pixel common baseline ink height
for A–Z/0–9. Proportional-font conversion should preserve this shared baseline;
the current YAFF importer instead centers each bitmap independently.

The 100-font difference between 775 and 675 comes from fonts with oversized
glyphs outside A–Z/0–9. Those fonts can contribute useful lettering while large
accented characters, symbols, or other extras are skipped. Punctuation and
lowercase still need their own size checks; the CSV records both.

The main exclusions are **812 fonts with complete but oversized A–Z/0–9**,
**511 without confirmed complete coverage**, and **153 non-Latin sources**.
The source filter takes precedence over coverage/size classification. It removes
29 fonts that were candidates in the earlier audit; the other excluded non-Latin
sources already failed coverage or size checks or were visually excluded.
Of the 511 coverage exclusions, 420 have no declared encoding, including
104 legacy `.draw` files. These are not all graphics:
many need character mapping work before they can be assessed fairly.

There are **250 additional unverified files** (147 YAFF and 103 `.draw`) with
nonblank, size-compatible bitmaps at native ASCII-numbered positions. Some are
likely useful text fonts, but their character identities have not been established.
The automated audit must not count them as confirmed Latin fonts. Conversely,
the 775 count must not be described as an exhaustive total of every usable font
in the archive.

Another **61** confirmed-coverage oversized fonts could fit if blank bitmap
padding were trimmed. These are outside the primary count. Allowing scaling
would expand the pool further, but would alter the original pixel artwork.

## Duplicates and existing libraries

| Comparison within the 775 candidates | Distinct sets |
| --- | ---: |
| Centered A–Z/0–9 pixel output only | **440** |
| All fitting replacement characters, including lowercase and punctuation | **497** |
| All fitting replacement characters, requiring every source glyph to fit | **434** |

The second comparison uses Font Lab's exact replacement-character list plus
lowercase. It ignores source metadata and unimportable extras. Two files can
share uppercase/digits but retain different lowercase or punctuation, so the
497 figure is more appropriate for a library than 440. These counts include
different pixel sizes and weights as separate entries; they are not counts of
typeface families.

Sixteen source fonts match the centered A–Z/0–9 output of fonts already in
Font Lab, representing nine distinct lettering sets. That leaves **431 distinct
uppercase/digit sets** with no exact existing match. Different positioning,
lowercase, punctuation, or outlines may still make a font useful. The matching
is exact pixel output before outline, not a judgement of stylistic similarity.

## Suggested library scope

Start from the **497 distinct replacement sets**, then make a visual selection.
Use the 434-set subset if the rule must be that no glyph anywhere in a source
font exceeds the cell. A practical lettering library can instead skip unusable
extras and keep all 497 candidates available for selection.

The biggest pools are Windows, OS/2, PC GEOS, Apple, and Oberon. There are also
Amiga, Acorn, Atari, Commodore, DEC terminal, MSX, and other machine fonts. Many
duplicates are the same faces shipped in different operating-system versions.

Very tiny fonts technically pass coverage/size checks but may not be good OSD
choices. In particular, some Windows Small Fonts sizes collapse several letters
or digits into identical shapes. The CSV records distinct uppercase and digit
shape counts so a later curation pass can remove those deliberately.

The outline-margin count measures maximum ink width ≤10 and common baseline ink
height ≤16, in addition to the normal bitmap eligibility checks. It means the
lettering can be positioned with a one-pixel border; it does not guarantee the
current per-glyph centering already provides that border on every side.

## Review artifacts

- [Candidate preview gallery](hoard-font-audit/gallery.html): a self-contained HTML
  file showing all 775 candidates, with uppercase, digits, and available fitting
  lowercase. It renders the actual source pixels at integer scale, without an outline.
- [Deduplicated candidate list](hoard-font-audit/library-candidates.csv): one
  representative for each of the 497 distinct replacement sets, including paths
  to equivalent sources. A source whose entire glyph set fits is preferred when
  multiple sources produce the same replacement.
- [Per-font CSV](hoard-font-audit/fonts.csv): all 2,251 files, coverage, size,
  encoding, exclusions, lowercase/punctuation checks, duplicate signatures, and
  matches against existing Font Lab fonts.
- [Machine-readable totals](hoard-font-audit/summary.json).
- [Groups sharing identical A–Z/0–9 output](hoard-font-audit/duplicates.json).
- [Parser warnings](hoard-font-audit/parser.log): unresolved encodings are preserved
  here rather than silently treated as ASCII.

Representative A–F/0–9 strips were visually inspected for every distinct
uppercase/digit output from the initial automatic selection. The review caught
the three non-Latin exclusions above. This is a compatibility audit and a
candidate gallery, not a final assessment of each character's readability in FPV use.

## Importer findings

The existing `js/modules/yaff.js` parser reports complete size-compatible native
A–Z/0–9 positions for 967 YAFF files. That should not become the library count:
it treats numeric machine indices as Unicode, can assign multi-character labels
incorrectly, and does not interpret character encodings or glyph metrics.

Six confirmed candidates need parsing/mapping support beyond the existing importer:
Apple II, three PDP-1 fonts, DEC Type 340, and the MC6847 font. Preconverting the
curated sources offline with monobit avoids making the browser importer a
general YAFF implementation.

## Reproduction

The original 21,040,199-byte archive is kept at
`tools/hoard-audit/source.zip`, under the repository's existing ignored `tools/`
directory. It is read directly because upstream includes paths containing `|`,
which Windows cannot extract normally. The full collection is not added to Git.

Archive SHA-256:
`953d858288e556ae60c526a379c5849034f55468fd8dcf97d79fe627841852e8`.

The local audit dependencies were installed under `tools/hoard-audit/python`,
using `monobit==0.54.0`. Node runs the actual application importer for comparison.

```powershell
python scripts/audit-hoard-fonts.py tools/hoard-audit/source.zip
```

The audit parsed all 2,251 font files without a file-level error. It does not
download anything during analysis or modify the website. Individual font
sources and terms remain relevant to a later bundling pass; upstream's
[licensing notes](https://github.com/robhagemans/hoard-of-bitfonts/blob/240a23ec828810504b45e6d9b0c5bd8065ab5d5c/LICENSE.md)
refer readers to individual sources/directories for any explicit terms.
