import { applyStroke4, applyStroke8 } from './preview.js';

export const EMOJI_ATLAS_COLUMNS = 32;

export function decodeEmojiCatalog(doc) {
  if (doc?.version !== 1 || doc.width !== 12 || doc.height !== 18 ||
      !doc.glyphs || typeof doc.glyphs !== 'object' || Array.isArray(doc.glyphs)) {
    throw new Error('Invalid emoji catalog');
  }
  const glyphs = new Map();
  for (const [file, encoded] of Object.entries(doc.glyphs)) {
    if (typeof encoded !== 'string') throw new Error(`Invalid emoji pixels: ${file}`);
    const packed = atob(encoded);
    if (packed.length !== 54) throw new Error(`Invalid emoji pixels: ${file}`);
    const glyph = new Uint8Array(216);
    for (let i = 0; i < glyph.length; i++) {
      const value = (packed.charCodeAt(i >> 2) >> ((i % 4) * 2)) & 3;
      if (!value) throw new Error(`Invalid emoji pixel: ${file}`);
      glyph[i] = value;
    }
    glyphs.set(file, { width: 12, height: 18, glyph });
  }
  if (!glyphs.size) throw new Error('Empty emoji catalog');
  return glyphs;
}

// Share pending requests as well as decoded pixels. A failed request can be retried.
export function createEmojiCatalog(url, fetcher = (...args) => fetch(...args)) {
  let pending = null;
  return {
    load() {
      if (!pending) {
        pending = (async () => {
          const response = await fetcher(url);
          if (!response.ok) throw new Error(`Emoji catalog HTTP ${response.status}`);
          return decodeEmojiCatalog(await response.json());
        })().catch(error => {
          pending = null;
          throw error;
        });
      }
      return pending;
    },
  };
}

export function renderEmojiGlyph(sourceGlyph, w, h, strokeStyle = '4') {
  const fill = new Uint8Array(w * h);
  for (let i = 0; i < fill.length; i++) fill[i] = sourceGlyph[i] >= 2 ? 2 : 1;
  const stroked = strokeStyle === '8' ? applyStroke8(fill, w, h) : applyStroke4(fill, w, h);
  for (let i = 0; i < stroked.length; i++) {
    if (sourceGlyph[i] === 2 || sourceGlyph[i] === 3) stroked[i] = sourceGlyph[i];
  }
  return stroked;
}

// One decoded image supplies every menu thumbnail. Scrolling only moves the grid.
export async function renderEmojiAtlas(files, glyphs, { palette, strokeStyle, isCurrent = () => true }) {
  const canvas = document.createElement('canvas');
  canvas.width = EMOJI_ATLAS_COLUMNS * 12;
  canvas.height = Math.ceil(files.length / EMOJI_ATLAS_COLUMNS) * 18;
  const ctx = canvas.getContext('2d');
  const colors = [null, null];
  for (const value of [2, 3]) {
    ctx.fillStyle = palette[value];
    ctx.fillRect(0, 0, 1, 1);
    colors[value] = ctx.getImageData(0, 0, 1, 1).data;
  }
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < files.length; i++) {
    if (!isCurrent()) return null;
    const source = glyphs.get(files[i]);
    if (!source) throw new Error(`Emoji missing from catalog: ${files[i]}`);
    const pixels = renderEmojiGlyph(source.glyph, 12, 18, strokeStyle);
    const ox = (i % EMOJI_ATLAS_COLUMNS) * 12;
    const oy = Math.floor(i / EMOJI_ATLAS_COLUMNS) * 18;
    for (let p = 0; p < pixels.length; p++) {
      if (pixels[p] === 1) continue;
      const target = ((oy + Math.floor(p / 12)) * canvas.width + ox + (p % 12)) * 4;
      image.data.set(colors[pixels[p]], target);
    }
    // Keep first opening and theme changes responsive, including on phones.
    if ((i + 1) % 64 === 0 && i + 1 < files.length) {
      await new Promise(resolve => document.hidden ? setTimeout(resolve, 0) : requestAnimationFrame(resolve));
    }
  }
  if (!isCurrent()) return null;
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL('image/png');
  const decoded = new Image();
  decoded.src = url;
  await decoded.decode();
  return { url, width: canvas.width, height: canvas.height };
}
