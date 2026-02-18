# Emoji Source PNG Library

This folder stores source PNGs for special-character emoji.

Current pipeline:

1. Place source emoji PNG files here (`uXXXX_name.png`).
2. Run:
   `python tools/emoji_png2json.py --src fonts/data/emoji --out-dir fonts/data/emoji-pixels --manifest fonts/manifest-emoji-pixels.json`
3. The app reads emoji from:
   - `fonts/manifest-emoji-pixels.json`
   - `fonts/data/emoji-pixels/*.json`

Notes:

- PNG transparency supports alpha, `#808080`, and `#00FF00`.
- Output glyph JSON encodes pixels as:
  - `1` transparent
  - `2` white
  - `3` black
