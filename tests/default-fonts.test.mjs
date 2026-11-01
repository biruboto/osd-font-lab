import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeMCM } from '../js/mcm.js';
import { createDefaultFontLibrary, decodeDefaultPreviews } from '../js/modules/default-fonts.js';

const read = path => readFileSync(new URL(`../fonts/${path}`, import.meta.url));
const json = path => JSON.parse(read(path).toString('utf8').replace(/^\uFEFF/, ''));
const sourceBuffer = file => {
  const data = read(`betaflight/${file}`);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};

test('default previews preserve each source sample without downloading full fonts', () => {
  const catalog = json('previews/betaflight.json');
  const previews = decodeDefaultPreviews(catalog);
  const manifest = json('bfmanifest.json');
  assert.deepEqual([...previews.keys()], manifest.map(entry => entry.file));
  for (const { file } of manifest) {
    const source = decodeMCM(sourceBuffer(file));
    for (const ch of catalog.text) {
      assert.deepEqual(previews.get(file).glyphs[ch.charCodeAt(0)], source.glyphs[ch.charCodeAt(0)], `${file}/${ch}`);
    }
  }
});

test('default picker previews share one small catalog and selected font loads share one request', async () => {
  const requests = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const library = createDefaultFontLibrary({ fetcher: async url => {
    requests.push(url);
    if (url.endsWith('.json')) return { ok: true, json: async () => json('previews/betaflight.json') };
    await gate;
    return { ok: true, arrayBuffer: async () => sourceBuffer('betaflight.mcm') };
  }});
  await Promise.all(json('bfmanifest.json').map(({ file }) => library.preview(file)));
  assert.deepEqual(requests, ['fonts/previews/betaflight.json']);
  const first = library.load('betaflight.mcm');
  assert.equal(first, library.load('betaflight.mcm'));
  release();
  const loaded = await first;
  assert.equal(await library.load('betaflight.mcm'), loaded);
  assert.deepEqual(loaded.font.glyphs, decodeMCM(sourceBuffer('betaflight.mcm')).glyphs);
  assert.deepEqual(requests, ['fonts/previews/betaflight.json', 'fonts/betaflight/betaflight.mcm']);
});

test('failed downloads and malformed fonts can be retried without retaining a broken cache entry', async () => {
  let attempts = 0;
  const library = createDefaultFontLibrary({ fetcher: async () => {
    attempts++;
    if (attempts === 1) return { ok: false, status: 503 };
    return { ok: true, arrayBuffer: async () => attempts === 2 ? new ArrayBuffer(0) : sourceBuffer('bold.mcm') };
  }});
  await assert.rejects(library.load('bold.mcm'), /503/);
  await assert.rejects(library.load('bold.mcm'), /MAX7456/);
  assert.equal((await library.load('bold.mcm')).font.glyphs.length, 256);
  assert.equal(attempts, 3);
});

test('preview failures can be retried and stalled font downloads time out', async () => {
  let attempts = 0;
  const library = createDefaultFontLibrary({ timeoutMs: 10, fetcher: async (url, options) => {
    if (url.endsWith('.json')) return { ok: ++attempts > 1, status: 503, json: async () => json('previews/betaflight.json') };
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError'))));
  }});
  await assert.rejects(library.preview('bold.mcm'), /503/);
  assert.equal((await library.preview('bold.mcm')).width, 12);
  await assert.rejects(library.load('bold.mcm'), { name: 'AbortError' });
});
