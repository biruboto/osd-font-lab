import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as codec from "../js/mcm.js";

const buffer = (text) => new TextEncoder().encode(text).buffer;
const solidMcm = (byte) => buffer(`MAX7456\r\n${Array(256 * 64).fill(byte).join("\r\n")}\r\n`);

test("all bundled defaults retain their pixels through MCM export", async () => {
  const manifest = JSON.parse((await readFile(new URL("../fonts/bfmanifest.json", import.meta.url), "utf8")).replace(/^\uFEFF/, ""));
  for (const entry of manifest) {
    const bytes = await readFile(new URL(`../fonts/betaflight/${entry.file}`, import.meta.url));
    const font = codec.decodeMCM(bytes);
    const restored = codec.decodeMCM(buffer(codec.encodeMCM(font)));
    assert.deepEqual(restored.glyphs, font.glyphs, entry.file);
  }
});

test("both hardware transparency codes normalize to transparent editor pixels", () => {
  const alternate = codec.decodeMCM(solidMcm("11111111"));
  const transparent = codec.decodeMCM(solidMcm("01010101"));
  assert.ok(alternate.glyphs.every((glyph, i) => glyph.every((pixel, j) => pixel === transparent.glyphs[i][j])),
    "raw 11 transparency must not become editor stroke pixels");
  assert.equal(codec.encodeMCM(alternate).split("\r\n")[1], "01010101");
});

test("serial bytes and MCM bytes use the same pixel packing", () => {
  const font = codec.decodeMCM(solidMcm("01010101"));
  font.glyphs[0].set([0, 1, 2, 3]); // black, transparent, white, editor stroke
  const packed = codec.encodeFontBytes(font);
  assert.equal(packed.length, 256 * 54);
  assert.equal(packed[0], 0b00011000);
  const lines = codec.encodeMCM(font).trim().split("\r\n").slice(1);
  for (let glyph = 0; glyph < 256; glyph++) {
    assert.deepEqual(lines.slice(glyph * 64, glyph * 64 + 54).map((s) => parseInt(s, 2)),
      Array.from(packed.subarray(glyph * 54, (glyph + 1) * 54)));
    assert.ok(lines.slice(glyph * 64 + 54, (glyph + 1) * 64).every((s) => s === "01010101"));
  }
});

test("malformed imports fail instead of producing a partial font", () => {
  assert.throws(() => codec.decodeMCM(buffer("invalid")), /MAX7456/);
  assert.throws(() => codec.decodeMCM(buffer("MAX7456\n01010101")), /too short/);
  const bad = new TextDecoder().decode(solidMcm("01010101")).replace("01010101", "invalid!");
  assert.throws(() => codec.decodeMCM(buffer(bad)), /Invalid MCM byte/);
});

test("file and serial export validate the complete font before packing", () => {
  const font = codec.decodeMCM(solidMcm("01010101"));
  font.glyphs[255] = new Uint8Array(215);
  assert.throws(() => codec.encodeMCM(font), /Glyph 255/);
  assert.throws(() => codec.encodeFontBytes(font), /Glyph 255/);
  assert.throws(() => codec.encodeMCM(null), /font|glyphs/i);
});
