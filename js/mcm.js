// js/mcm.js
// Decodes Betaflight "MAX7456" text .mcm files into 256 glyphs of 12x18 pixels (2bpp).
// Returns: { glyphs: Uint8Array[256], width:12, height:18 }

export function decodeMCM(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const GLYPHS = 256, W = 12, H = 18;
  const BYTES_PER_GLYPH_PADDED = 64; // text MCM stores 64 bytes per glyph

  const head = new TextDecoder("ascii").decode(bytes.slice(0, 16));
  const isTextMCM = head.startsWith("MAX7456");

  if (!isTextMCM) {
    throw new Error("This decoder currently expects a MAX7456 text .mcm (starts with 'MAX7456').");
  }

  const text = new TextDecoder("ascii").decode(bytes);
  const lines = text.split(/\r?\n/);

  if (lines[0].trim() !== "MAX7456") {
    throw new Error("Not a MAX7456 text MCM file.");
  }

  const bitLines = lines.slice(1).filter(s => s.trim().length);
  const needed = GLYPHS * BYTES_PER_GLYPH_PADDED;

  if (bitLines.length < needed) {
    throw new Error(`MCM text file too short: got ${bitLines.length} byte-lines, need ${needed}.`);
  }

  // Convert "01010101" lines to bytes
  const glyphBytes = new Uint8Array(needed);
  for (let i = 0; i < needed; i++) {
    const s = bitLines[i].trim();
    if (!/^[01]{8}$/.test(s)) {
      throw new Error(`Invalid MCM byte line at index ${i}: "${s}"`);
    }
    glyphBytes[i] = parseInt(s, 2);
  }

  // Decode 2bpp pixels into per-glyph arrays
  const glyphs = [];
  for (let g = 0; g < GLYPHS; g++) {
    const pixels = new Uint8Array(W * H);
    const base = g * BYTES_PER_GLYPH_PADDED;

    for (let y = 0; y < H; y++) {
      const b0 = glyphBytes[base + y * 3 + 0];
      const b1 = glyphBytes[base + y * 3 + 1];
      const b2 = glyphBytes[base + y * 3 + 2];
      const bits24 = (b0 << 16) | (b1 << 8) | b2;

      for (let x = 0; x < W; x++) {
        const shift = 22 - x * 2;           // MSB-first
        const v = (bits24 >> shift) & 0x03; // 2-bit pixel
        // Hardware 11 is transparent; editor value 3 means opaque stroke.
        pixels[y * W + x] = v === 3 ? 1 : v;
      }
    }

    glyphs.push(pixels);
  }

  return { glyphs, width: W, height: H, format: "mcm-text" };
}

// The packed glyph payload is shared by MCM files and flight-controller uploads.
export function encodeFontBytes(font) {
  if (!font?.glyphs || font.glyphs.length !== 256) {
    throw new Error("Font export expects 256 glyphs");
  }
  const { width: W, height: H } = font;

  if (W !== 12 || H !== 18) {
    throw new Error(`Font export expects 12x18 glyphs, got ${W}x${H}`);
  }

  // Map your internal values to MAX7456 2bpp:
  // 00 = black opaque
  // 01 = transparent
  // 10 = white opaque
  // 11 = transparent
  //
  // Your editor values:
  // 0 black  -> 00
  // 1 gray   -> treat as transparent (01) in the chip file
  // 2 white  -> 10
  // 3 stroke -> black opaque (00)
  function v2bpp(v) {
    if (v === 2) return 0b10; // white
    if (v === 0 || v === 3) return 0b00; // black
    return 0b01; // treat everything else as transparent
  }

  const bytes = new Uint8Array(256 * 54);

  for (let gi = 0; gi < 256; gi++) {
    const g = font.glyphs[gi];
    if (!(g instanceof Uint8Array) || g.length !== W * H) {
      throw new Error(`Glyph ${gi} invalid length`);
    }

    // Pack row-major, left-to-right, top-to-bottom, 4 pixels per byte:
    // bits [7:6]=p0 [5:4]=p1 [3:2]=p2 [1:0]=p3
    let p = 0;
    for (let bi = 0; bi < 54; bi++) {
      const p0 = v2bpp(g[p++]);
      const p1 = v2bpp(g[p++]);
      const p2 = v2bpp(g[p++]);
      const p3 = v2bpp(g[p++]);

      const byte =
        (p0 << 6) |
        (p1 << 4) |
        (p2 << 2) |
        (p3 << 0);

      bytes[gi * 54 + bi] = byte;
    }
  }
  return bytes;
}

export function encodeMCM(font) {
  const bytes = encodeFontBytes(font);
  const lines = ["MAX7456"];
  for (let gi = 0; gi < 256; gi++) {
    for (const byte of bytes.subarray(gi * 54, (gi + 1) * 54)) {
      lines.push(byte.toString(2).padStart(8, "0"));
    }

    // 10 unused bytes
    for (let k = 0; k < 10; k++) {
      lines.push("01010101");
    }
  }

  // EV-kit format uses CRLF
  return lines.join("\r\n") + "\r\n";
}
