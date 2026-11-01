// Run: node scripts/build-default-previews.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeMCM, encodeFontBytes } from '../js/mcm.js';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('fonts/bfmanifest.json', root), 'utf8').replace(/^\uFEFF/, ''));
const text = 'ABC123';
const fonts = {};
for (const entry of manifest) {
  const source = readFileSync(new URL(`fonts/betaflight/${entry.file}`, root));
  const font = decodeMCM(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  const packed = encodeFontBytes(font);
  fonts[entry.file] = Buffer.concat([...text].map(ch => {
    const offset = ch.charCodeAt(0) * 54;
    return packed.subarray(offset, offset + 54);
  })).toString('base64');
}
const output = new URL('fonts/previews/betaflight.json', root);
const data = JSON.stringify({ version: 1, width: 12, height: 18, text, fonts }) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== data) throw new Error('Default previews are stale; run node scripts/build-default-previews.mjs');
} else {
  writeFileSync(output, data);
}
console.log(`${manifest.length} default fonts, ${Buffer.byteLength(data).toLocaleString()} preview bytes`);
