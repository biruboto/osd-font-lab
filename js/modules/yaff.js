// js/modules/yaff.js
const DEFAULT_CELL_W = 12;
const DEFAULT_CELL_H = 18;

function parseLabelCodepoints(labelLine) {
  const label = String(labelLine || "").trim();
  if (!label) return [];

  // Unicode label(s): u+0041 or U+0041, u+0061, u+0300
  if (/^u\+/i.test(label)) {
    return label
      .split(",")
      .map((part) => part.trim())
      .map((part) => {
        const m = /^u\+([0-9a-f]+)$/i.exec(part);
        if (!m) return null;
        return parseInt(m[1], 16);
      })
      .filter((n) => Number.isInteger(n) && n >= 0);
  }

  // Codepoint label(s): 0x41, 65, 255
  if (/^(?:0x[0-9a-f]+|\d+)(?:\s*,\s*(?:0x[0-9a-f]+|\d+))*$/i.test(label)) {
    return label
      .split(",")
      .map((part) => part.trim())
      .map((part) => parseInt(part, 0))
      .filter((n) => Number.isInteger(n) && n >= 0);
  }

  // Tag labels are intentionally ignored in this first pass.
  return [];
}

function rowToBits(row) {
  let value = 0;
  for (let i = 0; i < row.length; i++) {
    value <<= 1;
    if (row[i] === "@") value |= 1;
  }
  return value >>> 0;
}

function extractGlyphDefs(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  const defs = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty, comments, properties.
    if (
      !trimmed
      || /^#/.test(trimmed)
      || (/^[A-Za-z0-9_.-]+\s*:\s+\S/.test(trimmed) && !/^\s/.test(line))
    ) {
      i += 1;
      continue;
    }

    // Labels are non-indented lines ending with ":".
    if (!/^\s/.test(line) && /:\s*$/.test(line)) {
      const labels = [];
      while (i < lines.length) {
        const l = lines[i];
        if (/^\s/.test(l) || !/:\s*$/.test(l)) break;
        labels.push(l.replace(/:\s*$/, "").trim());
        i += 1;
      }

      // Glyph block: one or more indented lines.
      const glyphRows = [];
      while (i < lines.length) {
        const gl = lines[i];
        if (!/^\s/.test(gl)) break;
        const body = gl.trim();
        if (!body) {
          i += 1;
          continue;
        }
        glyphRows.push(body);
        i += 1;
      }

      if (!glyphRows.length) continue;
      if (glyphRows.length === 1 && glyphRows[0] === "-") continue; // empty glyph

      if (!glyphRows.every((r) => /^[.@]+$/.test(r))) continue;
      const width = glyphRows[0].length;
      if (!glyphRows.every((r) => r.length === width)) continue;

      defs.push({ labels, rows: glyphRows, width, height: glyphRows.length });
      continue;
    }

    i += 1;
  }

  return defs;
}

export function parseYaffToOverlay(text, { cellW = DEFAULT_CELL_W, cellH = DEFAULT_CELL_H } = {}) {
  const defs = extractGlyphDefs(text);
  const glyphs = {};
  const stats = {
    blocksFound: defs.length,
    labelsUnsupported: 0,
    oversizeSkipped: 0,
    codepointsAssigned: 0,
  };

  for (const def of defs) {
    const cps = def.labels.flatMap(parseLabelCodepoints);
    if (!cps.length) {
      stats.labelsUnsupported += 1;
      continue;
    }

    if (def.width > cellW || def.height > cellH) {
      stats.oversizeSkipped += cps.length;
      continue;
    }

    const sizeW = def.width;
    const sizeH = def.height;
    const ox = Math.floor((cellW - sizeW) / 2);
    const oy = Math.floor((cellH - sizeH) / 2);
    const rows = def.rows.map((r) => rowToBits(r));

    for (const cp of cps) {
      // This app primarily uses BMP code points in U+XXXX form.
      if (cp < 0 || cp > 0xffff) continue;
      const key = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
      glyphs[key] = {
        offset: [ox, oy],
        rows,
        size: [sizeW, sizeH],
      };
      stats.codepointsAssigned += 1;
    }
  }

  return {
    cell: [cellW, cellH],
    glyphs,
    _importStats: {
      ...stats,
      glyphsImported: Object.keys(glyphs).length,
    },
  };
}
