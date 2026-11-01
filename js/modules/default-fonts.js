import { decodeMCM } from '../mcm.js';

export function decodeDefaultPreviews(doc) {
  if (doc?.version !== 1 || doc.width !== 12 || doc.height !== 18 || doc.text !== 'ABC123' ||
      !doc.fonts || typeof doc.fonts !== 'object' || Array.isArray(doc.fonts)) {
    throw new Error('Invalid default font previews');
  }
  const fonts = new Map();
  for (const [file, encoded] of Object.entries(doc.fonts)) {
    const packed = atob(encoded);
    if (packed.length !== doc.text.length * 54) throw new Error(`Invalid default preview: ${file}`);
    const glyphs = [];
    [...doc.text].forEach((ch, index) => {
      const glyph = new Uint8Array(216);
      for (let p = 0; p < glyph.length; p++) {
        const value = (packed.charCodeAt(index * 54 + (p >> 2)) >> (6 - (p % 4) * 2)) & 3;
        glyph[p] = value === 3 ? 1 : value;
      }
      glyphs[ch.charCodeAt(0)] = glyph;
    });
    fonts.set(file, { width: 12, height: 18, glyphs });
  }
  if (!fonts.size) throw new Error('Empty default font previews');
  return fonts;
}

export function createDefaultFontLibrary({
  fetcher = (...args) => fetch(...args),
  previewUrl = 'fonts/previews/betaflight.json',
  timeoutMs = 30000,
} = {}) {
  const fonts = new Map();
  let previews = null;
  return {
    load(file) {
      if (!fonts.has(file)) {
        const pending = (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetcher(`fonts/betaflight/${encodeURIComponent(file)}`, {
              signal: controller.signal, priority: 'high',
            });
            if (!response.ok) throw new Error(`Font download HTTP ${response.status}`);
            const buffer = await response.arrayBuffer();
            return { buffer, font: decodeMCM(buffer) };
          } finally {
            clearTimeout(timer);
          }
        })();
        fonts.set(file, pending);
        pending.catch(() => { if (fonts.get(file) === pending) fonts.delete(file); });
      }
      return fonts.get(file);
    },
    async preview(file) {
      if (!previews) {
        previews = (async () => {
          const response = await fetcher(previewUrl, { priority: 'low' });
          if (!response.ok) throw new Error(`Default previews HTTP ${response.status}`);
          return decodeDefaultPreviews(await response.json());
        })().catch(error => { previews = null; throw error; });
      }
      const font = (await previews).get(file);
      if (!font) throw new Error(`Default preview missing: ${file}`);
      return font;
    },
  };
}
