import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmojiCatalog, decodeEmojiCatalog, renderEmojiGlyph } from '../js/modules/emoji-preview.js';
import { applyStroke4, applyStroke8 } from '../js/modules/preview.js';

const read = path => JSON.parse(readFileSync(new URL(`../fonts/${path}`, import.meta.url), 'utf8'));
const catalog = read('previews/emoji-pixels.json');

test('compact emoji catalog reproduces every source pixel and both outline styles', () => {
  const decoded = decodeEmojiCatalog(catalog);
  const manifest = read('manifest-emoji-pixels.json');
  assert.equal(decoded.size, manifest.length);
  for (const entry of manifest) {
    const source = read(`data/emoji-pixels/${entry.file}`);
    const data = decoded.get(entry.file);
    assert.equal(data.width, source.width);
    assert.equal(data.height, source.height);
    assert.deepEqual([...data.glyph], source.glyph);
    for (const style of ['4', '8']) {
      const mask = Uint8Array.from(source.glyph, pixel => pixel === 1 ? 1 : 2);
      const expected = (style === '8' ? applyStroke8 : applyStroke4)(mask, 12, 18);
      source.glyph.forEach((pixel, i) => { if (pixel !== 1) expected[i] = pixel; });
      assert.deepEqual(renderEmojiGlyph(data.glyph, 12, 18, style), expected, `${entry.file}/${style}`);
      assert.deepEqual([...data.glyph], source.glyph, 'rendering preserves source pixels');
    }
  }
});

test('emoji catalog rejects malformed data before it can produce blank previews', () => {
  const entry = Object.keys(catalog.glyphs)[0];
  for (const doc of [null, { ...catalog, version: 2 }, { ...catalog, width: 24 },
    { ...catalog, glyphs: {} }, { ...catalog, glyphs: { [entry]: 'invalid' } },
    { ...catalog, glyphs: { [entry]: btoa('\0'.repeat(54)) } }]) {
    assert.throws(() => decodeEmojiCatalog(doc));
  }
});

test('emoji catalog loads on demand, shares concurrent requests, and retries failures', async () => {
  let requests = 0;
  let release;
  const loader = createEmojiCatalog('emoji.json', async () => {
    requests++;
    await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => catalog };
  });
  assert.equal(requests, 0);
  const first = loader.load();
  assert.equal(first, loader.load());
  release();
  assert.equal(await first, await loader.load());
  assert.equal(requests, 1);

  let attempts = 0;
  const retry = createEmojiCatalog('emoji.json', async () => {
    attempts++;
    return { ok: attempts > 1, status: 503, json: async () => catalog };
  });
  await assert.rejects(retry.load(), /503/);
  assert.equal((await retry.load()).size, 507);
  assert.equal(attempts, 2);
});
