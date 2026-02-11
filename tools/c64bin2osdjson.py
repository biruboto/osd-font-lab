#!/usr/bin/env python3
"""
c64bin2osdjson.py

Convert raw C64-style charset binaries (8x8 glyph bytes) into OSD Font Lab JSON.

Expected input:
- Raw binary where each glyph is 8 bytes (one byte per row, MSB-left).
- Typical sizes:
  - 2048 bytes => 256 glyphs
  - 1024 bytes => 128 glyphs
  - any multiple of 8 bytes
- Common `.FNT` variant:
  - 1030 bytes total => 6-byte header + 1024 glyph bytes
  - auto-detected and stripped by default.

Output schema matches existing overlay JSON:
{
  "cell": [12, 18],
  "glyphs": {
    "U+0041": { "size":[8,8], "offset":[2,5], "rows":[...] },
    ...
  }
}

Usage:
  python tools/c64bin2osdjson.py in.bin out.json
  python tools/c64bin2osdjson.py in.bin out.json --cp-base 0
  python tools/c64bin2osdjson.py in.bin out.json --max-glyphs 256
  python tools/c64bin2osdjson.py GRUBE.FNT out.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


CELL_W = 12
CELL_H = 18
GLYPH_W = 8
GLYPH_H = 8
BYTES_PER_GLYPH = 8


def uplus(cp: int) -> str:
    return f"U+{cp:04X}" if cp <= 0xFFFF else f"U+{cp:06X}"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Convert raw C64 charset binary to OSD overlay JSON.")
    p.add_argument("input", type=Path, help="Input charset binary (.bin/.rom/etc)")
    p.add_argument("output", type=Path, help="Output overlay JSON")
    p.add_argument(
        "--cp-base",
        type=int,
        default=0,
        help="Unicode codepoint base for glyph index 0 (default: 0)",
    )
    p.add_argument(
        "--max-glyphs",
        type=int,
        default=256,
        help="Max glyphs to emit (default: 256)",
    )
    p.add_argument(
        "--name",
        type=str,
        default="",
        help="Optional output font name (default: input stem)",
    )
    p.add_argument(
        "--header-bytes",
        type=int,
        default=-1,
        help=(
            "Header bytes to skip before glyph data. "
            "Default: auto-detect known FNT header (6 bytes) when applicable."
        ),
    )
    return p.parse_args()


def detect_header_bytes(raw: bytes) -> int:
    n = len(raw)
    if n % BYTES_PER_GLYPH == 0:
        return 0

    # Common emulator FNT observed: 6-byte header + 1024 charset bytes.
    # We keep this narrow to avoid accidental stripping.
    if n >= 6 and (n - 6) % BYTES_PER_GLYPH == 0 and raw[:2] == b"\xFF\xFF":
        return 6

    return 0


def main() -> int:
    args = parse_args()
    raw_all = args.input.read_bytes()
    if args.header_bytes >= 0:
        header_bytes = args.header_bytes
    else:
        header_bytes = detect_header_bytes(raw_all)

    if header_bytes < 0 or header_bytes > len(raw_all):
        raise SystemExit(f"Invalid --header-bytes value: {header_bytes}")

    raw = raw_all[header_bytes:]

    if len(raw) % BYTES_PER_GLYPH != 0:
        raise SystemExit(
            f"Glyph data size must be a multiple of {BYTES_PER_GLYPH} bytes; got {len(raw)} bytes "
            f"(total file bytes: {len(raw_all)}, skipped header: {header_bytes})."
        )

    glyph_count = len(raw) // BYTES_PER_GLYPH
    emit_count = min(glyph_count, max(0, args.max_glyphs))

    # 8x8 centered in 12x18
    xoff = (CELL_W - GLYPH_W) // 2  # 2
    yoff = (CELL_H - GLYPH_H) // 2  # 5

    out = {
        "name": args.name or args.input.stem,
        "cell": [CELL_W, CELL_H],
        "source": {
            "format": "c64-binary",
            "file": args.input.name,
            "bytes": len(raw),
            "bytesTotal": len(raw_all),
            "headerBytesSkipped": header_bytes,
            "glyphCount": glyph_count,
            "emittedGlyphs": emit_count,
            "cpBase": args.cp_base,
        },
        "glyphs": {},
    }

    for gi in range(emit_count):
        cp = args.cp_base + gi
        key = uplus(cp)
        rows = list(raw[gi * BYTES_PER_GLYPH : (gi + 1) * BYTES_PER_GLYPH])
        out["glyphs"][key] = {
            "size": [GLYPH_W, GLYPH_H],
            "offset": [xoff, yoff],
            "rows": rows,
        }

    args.output.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(
        f"Wrote {args.output} with {emit_count} glyphs "
        f"(input glyphs: {glyph_count}, glyph-bytes: {len(raw)}, header-skipped: {header_bytes})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
