#!/usr/bin/env python3
"""
bdf2osdjson.py

Convert a BDF bitmap font into OSD Font Lab overlay JSON:
- target cell: 12x18
- glyph stored as { size:[w,h], offset:[xoff,yoff], rows:[bitmask...] }
- glyph keys are Unicode codepoints: "U+0041"

Centered placement by default.

Usage:
  python tools/bdf2osdjson.py "Anarchist Heavy.bdf" "anarchist-heavy.json"
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


CELL_W = 12
CELL_H = 18


@dataclass
class BdfGlyph:
    codepoint: int
    bbx_w: int
    bbx_h: int
    bbx_xoff: int
    bbx_yoff: int
    bitmap_rows_hex: List[str]


def _uplus(cp: int) -> str:
    return f"U+{cp:04X}" if cp <= 0xFFFF else f"U+{cp:06X}"


def _parse_ints(line: str, count: int) -> Tuple[int, ...]:
    parts = line.strip().split()
    if len(parts) < count:
        raise ValueError(f"Expected {count} ints in line: {line!r}")
    return tuple(int(p, 10) for p in parts[:count])


def parse_bdf(text: str) -> Tuple[Dict[str, str], List[BdfGlyph]]:
    """
    Minimal BDF parser sufficient for typical bitmap BDFs.
    Supports:
      - FONT, SIZE, FONT_ASCENT, FONT_DESCENT (as metadata)
      - STARTCHAR ... ENDCHAR blocks
      - ENCODING, BBX, BITMAP rows (hex)
    """
    meta: Dict[str, str] = {}
    glyphs: List[BdfGlyph] = []

    lines = text.splitlines()
    i = 0
    n = len(lines)

    def peek() -> str:
        return lines[i] if i < n else ""

    while i < n:
        line = lines[i].rstrip("\n")
        i += 1

        if not line.strip():
            continue

        if line.startswith("FONT "):
            meta["name"] = line.split(" ", 1)[1].strip()
        elif line.startswith("SIZE "):
            meta["size"] = line.split(" ", 1)[1].strip()
        elif line.startswith("FONT_ASCENT "):
            meta["ascent"] = line.split(" ", 1)[1].strip()
        elif line.startswith("FONT_DESCENT "):
            meta["descent"] = line.split(" ", 1)[1].strip()
        elif line.startswith("STARTCHAR "):
            # Parse glyph block
            codepoint: Optional[int] = None
            bbx_w = bbx_h = bbx_xoff = bbx_yoff = 0
            bitmap_rows_hex: List[str] = []
            in_bitmap = False

            while i < n:
                l = lines[i].strip("\n")
                i += 1

                if l.startswith("ENCODING "):
                    # Some BDFs use -1 for unencoded glyphs
                    try:
                        cp = int(l.split()[1], 10)
                    except Exception:
                        cp = -1
                    codepoint = cp
                elif l.startswith("BBX "):
                    bbx_w, bbx_h, bbx_xoff, bbx_yoff = _parse_ints(l.split(" ", 1)[1], 4)
                elif l == "BITMAP":
                    in_bitmap = True
                elif l == "ENDCHAR":
                    break
                elif in_bitmap:
                    # Bitmap rows are hex strings (one per row)
                    row = l.strip()
                    if row and re.fullmatch(r"[0-9A-Fa-f]+", row):
                        bitmap_rows_hex.append(row)

            if codepoint is None or codepoint < 0:
                # Skip unencoded glyphs
                continue

            glyphs.append(
                BdfGlyph(
                    codepoint=codepoint,
                    bbx_w=bbx_w,
                    bbx_h=bbx_h,
                    bbx_xoff=bbx_xoff,
                    bbx_yoff=bbx_yoff,
                    bitmap_rows_hex=bitmap_rows_hex,
                )
            )

    return meta, glyphs


def hex_row_to_bits(hex_str: str, width: int) -> int:
    """
    Convert a BDF BITMAP hex row into an integer bitmask of exactly `width` bits.
    BDF rows are MSB-left. We take the top `width` bits from the row value.

    Example: width=8, hex "18" -> 0b00011000 (24)
    """
    val = int(hex_str, 16)

    # BDF rows may be padded to whole bytes; determine how many bits are present.
    row_bits = len(hex_str) * 4
    if row_bits < width:
        # Not enough bits: left-pad with zeros (rare, but safe)
        val = val << (width - row_bits)
        row_bits = width

    # Take the leftmost `width` bits (MSB-left)
    shift = row_bits - width
    if shift > 0:
        val = val >> shift

    # Ensure width bits only
    return val & ((1 << width) - 1)


def clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def convert_glyph_to_overlay(g: BdfGlyph) -> Optional[dict]:
    """
    Convert a BdfGlyph into overlay JSON entry:
      { "size":[w,h], "offset":[x,y], "rows":[...] }

    Centered placement into 12x18.
    Crops if glyph exceeds 12x18.
    """
    if g.bbx_w <= 0 or g.bbx_h <= 0:
        return None
    if not g.bitmap_rows_hex:
        return None

    # BDF bitmap rows count should equal bbx_h, but some fonts are sloppy.
    src_h = min(g.bbx_h, len(g.bitmap_rows_hex))
    src_w = g.bbx_w

    # Crop to cell
    w = min(src_w, CELL_W)
    h = min(src_h, CELL_H)

    # Center placement
    xoff = (CELL_W - w) // 2
    yoff = (CELL_H - h) // 2

    # Convert rows to bitmasks, cropped to width `w`
    rows: List[int] = []
    for r in range(h):
        bits_full = hex_row_to_bits(g.bitmap_rows_hex[r], src_w)
        # If we cropped width, take leftmost w bits
        if src_w > w:
            bits = bits_full >> (src_w - w)
        else:
            bits = bits_full
        rows.append(bits)

    return {
        "size": [w, h],
        "offset": [xoff, yoff],
        "rows": rows,
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: python bdf2osdjson.py ইন.bdf out.json")
        return 2

    in_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    text = in_path.read_text(encoding="utf-8", errors="replace")
    meta, glyphs = parse_bdf(text)

    out = {
        "name": meta.get("name", in_path.stem),
        "cell": [CELL_W, CELL_H],
        "source": {
            "format": "bdf",
            "file": in_path.name,
            **{k: v for k, v in meta.items() if k != "name"},
        },
        "glyphs": {},
    }

    # Convert
    count = 0
    for g in glyphs:
        entry = convert_glyph_to_overlay(g)
        if entry is None:
            continue
        out["glyphs"][_uplus(g.codepoint)] = entry
        count += 1

    out_path.write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    print(f"Wrote {out_path} with {count} glyphs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
