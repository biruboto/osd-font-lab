# Emoji Library Notes

- Put emoji overlay JSON files in this folder.
- Use ASCII-safe filenames, for example: `u1f680_rocket.json`
- Match existing overlay font JSON structure:
  - `cell: [12, 18]`
  - `glyphs: { "U+0020": { ... } }`
- Update `fonts/manifest-emoji.json` with one entry per file.
