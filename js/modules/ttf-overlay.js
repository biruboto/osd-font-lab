const DEFAULT_CELL_W = 12;
const DEFAULT_CELL_H = 18;
const DEFAULT_STROKE_MARGIN = 1;
const DEFAULT_OVERSAMPLE = 4;
const DEFAULT_THRESHOLD = 96;
const MEASURE_SIZE = 1000;
let nextSourceId = 0;

function codepointsFromText(text) {
  return [...new Set([...String(text || "")].map((ch) => ch.codePointAt(0)))];
}

function maskToRows(mask, w, h) {
  return Array.from({ length: h }, (_, y) => {
    let bits = 0;
    for (let x = 0; x < w; x++) bits = (bits << 1) | mask[y * w + x];
    return bits >>> 0;
  });
}

function integerOption(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

// Share the body size and baseline, without letting one swash or wide letter
// limit the whole font. Oversized glyphs fit individually around that baseline.
export function planTtfLayout(glyphs, {
  cellW = DEFAULT_CELL_W,
  cellH = DEFAULT_CELL_H,
  strokeMargin = DEFAULT_STROKE_MARGIN,
  sizePx = 12,
} = {}) {
  integerOption(cellW, 1, 32, "Cell width"); // Rows use 32-bit integers.
  integerOption(cellH, 1, 256, "Cell height");
  integerOption(strokeMargin, 0, Math.floor((Math.min(cellW, cellH) - 1) / 2), "Stroke margin");
  if (!Number.isFinite(sizePx) || sizePx <= 0) throw new Error("Font size must be positive.");
  const innerH = cellH - strokeMargin * 2;
  const ink = glyphs.filter((g) => !g.blank);
  const letters = ink.filter((g) => /^[A-Za-z0-9]$/.test(g.ch));
  const body = letters.length ? letters : ink;
  // The upper quartile includes ordinary capitals/ascenders while ignoring a
  // few tall ornaments. Descender letters reserve real room below the baseline;
  // tiny positive overshoots on capitals must not crowd them out.
  const ascent = Math.max(0, percentile(body.map((g) => g.ascent), 0.75));
  const descenders = body.filter((g) => /^[gjpqy]$/.test(g.ch) && g.descent > 0);
  const descent = percentile((descenders.length ? descenders : body).map((g) => g.descent).filter((d) => d > 0), 0.5);
  const effectiveSizePx = Math.min(sizePx,
    ascent + descent > 0 ? innerH / (ascent + descent) : sizePx);
  const baseline = strokeMargin + (innerH - (ascent + descent) * effectiveSizePx) / 2
    + ascent * effectiveSizePx;
  return { cellW, cellH, strokeMargin, sizePx, effectiveSizePx, baseline };
}

export function planTtfGlyph(glyph, layout) {
  const { cellW, cellH, strokeMargin, effectiveSizePx: size, baseline } = layout;
  const width = (glyph.left + glyph.right) * size;
  const ascent = glyph.ascent * size;
  const descent = glyph.descent * size;
  const scaleX = width > 0 ? Math.min(1, (cellW - strokeMargin * 2) / width) : 1;
  const scaleY = Math.min(1,
    ascent > 0 ? (baseline - strokeMargin) / ascent : 1,
    descent > 0 ? (cellH - strokeMargin - baseline) / descent : 1);
  const x = (cellW + (glyph.left - glyph.right) * size * scaleX) / 2;
  return { x, scaleX, scaleY };
}

export async function loadTtfSource(file) {
  // Lazy and local: the parser is only downloaded when importing an outline font.
  const [{ parse }, bytes] = await Promise.all([
    import("../vendor/opentype-2.0.0/opentype.mjs"),
    file.arrayBuffer(),
  ]);
  const font = parse(bytes, { lowMemory: true });
  const family = `osd_ttf_${Date.now()}_${++nextSourceId}`;
  const face = new FontFace(family, bytes);
  await face.load();
  let disposed = false;
  const measurements = new Map();
  const srcCanvas = document.createElement("canvas");
  const src = srcCanvas.getContext("2d", { willReadFrequently: true });
  const dstCanvas = document.createElement("canvas");
  const dst = dstCanvas.getContext("2d", { willReadFrequently: true });
  if (!src || !dst) {
    throw new Error("Canvas rendering is unavailable.");
  }
  document.fonts.add(face);

  function measure(cp) {
    if (measurements.has(cp)) return measurements.get(cp);
    const ch = String.fromCodePoint(cp);
    // Canvas text may use system fallback or .notdef. Check the uploaded font first.
    const index = font.charToGlyphIndex(ch);
    let g = null;
    if (Number.isInteger(index) && index > 0) {
      src.font = `${MEASURE_SIZE}px "${family}"`;
      const m = src.measureText(ch);
      g = {
        ch,
        left: m.actualBoundingBoxLeft / MEASURE_SIZE,
        right: m.actualBoundingBoxRight / MEASURE_SIZE,
        ascent: m.actualBoundingBoxAscent / MEASURE_SIZE,
        descent: m.actualBoundingBoxDescent / MEASURE_SIZE,
      };
      g.blank = g.left + g.right <= 0 || g.ascent + g.descent <= 0;
    }
    measurements.set(cp, g);
    return g;
  }

  return {
    file,
    dispose() {
      if (disposed) return;
      disposed = true;
      document.fonts.delete(face);
      measurements.clear();
      srcCanvas.width = dstCanvas.width = 0;
    },
    render({
      charset = "",
      oversample = DEFAULT_OVERSAMPLE,
      threshold = DEFAULT_THRESHOLD,
      ...options
    } = {}) {
      if (disposed) throw new Error("This font source has been released.");
      integerOption(oversample, 1, 16, "Oversampling");
      integerOption(threshold, 1, 254, "Threshold");
      const cps = codepointsFromText(charset);
      const records = new Map();
      const stats = { attempted: cps.length, imported: 0, missing: 0, blank: 0, empty: 0, narrowed: 0, shortened: 0, skippedOutOfRange: 0 };
      for (const cp of cps) {
        if (cp > 0xffff || (cp >= 0xd800 && cp <= 0xdfff)) {
          stats.skippedOutOfRange++;
          continue;
        }
        const g = measure(cp);
        if (!g) stats.missing++;
        else records.set(cp, g);
      }
      const layout = planTtfLayout([...records.values()], options);
      const { cellW, cellH, effectiveSizePx, baseline } = layout;
      srcCanvas.width = cellW * oversample;
      srcCanvas.height = cellH * oversample;
      dstCanvas.width = cellW;
      dstCanvas.height = cellH;
      src.fillStyle = "#ffffff";
      src.font = `${effectiveSizePx * oversample}px "${family}"`;
      src.textBaseline = "alphabetic";
      src.textAlign = "left";
      dst.imageSmoothingEnabled = true;
      dst.imageSmoothingQuality = "high";
      const glyphs = {};
      for (const [cp, g] of records) {
        const mask = new Uint8Array(cellW * cellH);
        if (g.blank) {
          stats.blank++;
        } else {
          src.clearRect(0, 0, srcCanvas.width, srcCanvas.height);
          const placement = planTtfGlyph(g, layout);
          src.save();
          src.translate(placement.x * oversample, baseline * oversample);
          src.scale(placement.scaleX, placement.scaleY);
          src.fillText(g.ch, 0, 0);
          src.restore();
          dst.clearRect(0, 0, cellW, cellH);
          dst.drawImage(srcCanvas, 0, 0, cellW, cellH);
          const data = dst.getImageData(0, 0, cellW, cellH).data;
          let ink = false;
          for (let i = 0; i < mask.length; i++) {
            mask[i] = data[i * 4 + 3] >= threshold ? 1 : 0;
            ink ||= !!mask[i];
          }
          if (!ink) {
            stats.empty++;
            continue;
          }
          stats.imported++;
          if (placement.scaleX < 1 - 1e-6) stats.narrowed++;
          if (placement.scaleY < 1 - 1e-6) stats.shortened++;
        }
        glyphs[`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`] = {
          offset: [0, 0], size: [cellW, cellH], rows: maskToRows(mask, cellW, cellH),
        };
      }
      return {
        cell: [cellW, cellH], glyphs,
        _importStats: { source: "ttf", ...layout, ...stats, glyphsImported: Object.keys(glyphs).length },
      };
    },
  };
}

// Convenience for one-shot callers. Interactive imports retain the source instead.
export async function parseTtfToOverlay(file, options = {}) {
  const source = await loadTtfSource(file);
  try {
    return source.render(options);
  } finally {
    source.dispose();
  }
}
