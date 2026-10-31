import assert from "node:assert/strict";
import test from "node:test";
import { FCConnection } from "../js/modules/serial.js";

function frame(cmd, payload = [], direction = 62) {
  let checksum = cmd ^ payload.length;
  for (const byte of payload) checksum ^= byte;
  return Uint8Array.from([36, 77, direction, payload.length, cmd, ...payload, checksum]);
}

function connection(onWrite = () => {}, options = {}) {
  let input;
  const readable = new ReadableStream({ start(controller) { input = controller; } });
  const writes = [];
  let closed = 0;
  const fc = new FCConnection({ responseTimeoutMs: 100, writeIntervalMs: 0, retryDelayMs: 0, ...options });
  fc.reader = readable.getReader();
  const writable = new WritableStream({ write(data) {
    writes.push(Array.from(data));
    return onWrite(data, input);
  } });
  fc.writer = writable.getWriter();
  fc.port = { async close() { closed++; } };
  fc.connected = true;
  return { fc, input, readable, writable, writes, get closed() { return closed; } };
}

test("writes MSP v1 framing and accepts fragmented replies", async () => {
  const c = connection((data, input) => {
    for (const byte of frame(data[4], [1, 46, 0])) input.enqueue(Uint8Array.of(byte));
  });
  assert.deepEqual(Array.from(await c.fc.request(1, [4, 5])), [1, 46, 0]);
  assert.deepEqual(c.writes[0], [36, 77, 60, 2, 1, 4, 5, 2]);
  await c.fc.disconnect();
});

test("retains trailing frames and supports zero-length ACKs", async () => {
  const c = connection();
  c.input.enqueue(Uint8Array.from([...frame(1), ...frame(2, [66, 70]) ]));
  assert.equal((await c.fc.readMspResponse(1)).length, 0);
  assert.deepEqual(Array.from(await c.fc.readMspResponse(2)), [66, 70]);
  await c.fc.disconnect();
});

test("resynchronizes after noise/checksum errors and ignores unrelated error frames", async () => {
  const c = connection();
  const bad = frame(1, [42]);
  bad[bad.length - 1] ^= 1;
  c.input.enqueue(Uint8Array.from([0, 36, 36, ...bad, ...frame(2, [], 33), ...frame(1, [7])]));
  assert.deepEqual(Array.from(await c.fc.readMspResponse(1)), [7]);
  await c.fc.disconnect();
});

test("a stalled read times out, releases its lock, and prevents another write", { timeout: 1000 }, async () => {
  const c = connection(() => {}, { responseTimeoutMs: 20 });
  await assert.rejects(c.fc.request(1), { code: "MSP_TIMEOUT" });
  assert.equal(c.readable.locked, false);
  assert.equal(c.fc.connected, false);
  await assert.rejects(c.fc.request(2), { code: "MSP_DISCONNECTED" });
  assert.equal(c.writes.length, 1);
  await c.fc.disconnect();
  assert.equal(c.writable.locked, false);
  assert.equal(c.closed, 1);
});

test("cancelling an active request rejects it and releases the pending reader", async () => {
  const c = connection();
  const controller = new AbortController();
  const pending = c.fc.request(1, [], { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await new Promise(setImmediate);
  controller.abort();
  await rejected;
  assert.equal(c.readable.locked, false);
  await c.fc.disconnect();
});

test("disconnect rejects pending/queued work and releases both streams", async () => {
  const c = connection();
  const active = assert.rejects(c.fc.request(1), { code: "MSP_DISCONNECTED" });
  const queued = assert.rejects(c.fc.request(2), { code: "MSP_DISCONNECTED" });
  await new Promise(setImmediate);
  await c.fc.disconnect();
  await Promise.all([active, queued]);
  assert.equal(c.writes.length, 1);
  assert.equal(c.readable.locked, false);
  assert.equal(c.writable.locked, false);
});

test("requests queued concurrently exchange one command at a time", async () => {
  const c = connection((data, input) => input.enqueue(frame(data[4], [data[4]])));
  const results = await Promise.all([c.fc.request(1), c.fc.request(2)]);
  assert.deepEqual(results.map((v) => Array.from(v)), [[1], [2]]);
  assert.deepEqual(c.writes.map((v) => v[4]), [1, 2]);
  await c.fc.disconnect();
});

test("upload validates the whole font before sending a character", async () => {
  const c = connection();
  await assert.rejects(c.fc.uploadFont(new Uint8Array(55)), /256 characters/);
  assert.equal(c.writes.length, 0);
  await c.fc.disconnect();
});

test("upload retries explicit rejections and sends an immutable 256-glyph snapshot", async () => {
  const font = new Uint8Array(256 * 54).fill(0x55);
  let rejected = false;
  const c = connection((data, input) => {
    const first = data[5] === 0 && !rejected;
    if (first) rejected = true;
    input.enqueue(frame(87, [], first ? 33 : 62));
  });
  const progress = [];
  await c.fc.uploadFont(font, (current) => {
    progress.push(current);
    font.fill(0); // a caller editing its own data must not change this upload
  });
  assert.equal(c.writes.length, 257);
  assert.ok(c.writes.every((v) => v.slice(6, -1).every((byte) => byte === 0x55)));
  assert.deepEqual(progress, Array.from({ length: 256 }, (_, i) => i + 1));
  await c.fc.disconnect();
});

test("upload stops after three explicit rejections or the first timeout", async () => {
  const rejected = connection((data, input) => input.enqueue(frame(87, [], 33)));
  await assert.rejects(rejected.fc.uploadFont(new Uint8Array(256 * 54)), { code: "MSP_REJECTED" });
  assert.equal(rejected.writes.length, 3);
  await rejected.fc.disconnect();
  const silent = connection(() => {}, { responseTimeoutMs: 20 });
  await assert.rejects(silent.fc.uploadFont(new Uint8Array(256 * 54)), { code: "MSP_TIMEOUT" });
  assert.equal(silent.writes.length, 1);
  await silent.fc.disconnect();
});

test("cancelling between characters stops progress and later writes", async () => {
  const controller = new AbortController();
  const c = connection((data, input) => input.enqueue(frame(87)), { writeIntervalMs: 30 });
  const progress = [];
  await assert.rejects(c.fc.uploadFont(new Uint8Array(256 * 54), (current) => {
    progress.push(current);
    controller.abort();
  }, { signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(progress, [1]);
  assert.equal(c.writes.length, 1);
  await c.fc.disconnect();
});

test("cleanup still closes the port when a lock release throws", async (t) => {
  const c = connection();
  t.mock.method(console, "warn", () => {});
  const writer = c.fc.writer;
  c.fc.writer = { releaseLock() { throw new Error("failed release"); } };
  await c.fc.disconnect();
  assert.equal(c.closed, 1);
  assert.equal(c.readable.locked, false);
  writer.releaseLock();
});

test("empty OSD configuration and a closed stream are errors", async () => {
  const c = connection((data, input) => input.enqueue(frame(84)));
  await assert.rejects(c.fc.checkOSD(), /Invalid OSD/);
  await c.fc.disconnect();
  const closed = connection();
  closed.input.close();
  await assert.rejects(closed.fc.readMspResponse(1), { code: "MSP_DISCONNECTED" });
  assert.equal(closed.readable.locked, false);
  await closed.fc.disconnect();
});

test("a stalled write also has a deadline", async () => {
  let finishWrite;
  const c = connection(() => new Promise((resolve) => { finishWrite = resolve; }), { responseTimeoutMs: 20 });
  await assert.rejects(c.fc.request(1), { code: "MSP_TIMEOUT" });
  finishWrite();
  await new Promise(setImmediate);
  assert.equal(c.fc.reader, null);
  await c.fc.disconnect();
});

test("connect cleans partial resources when stream setup fails", async (t) => {
  t.mock.method(console, "error", () => {});
  let released = false;
  let closed = false;
  const fc = new FCConnection({ serial: { async requestPort() { return {
    async open() {},
    writable: { getWriter() { return { releaseLock() { released = true; } }; } },
    readable: { getReader() { throw new Error("reader failed"); } },
    async close() { closed = true; },
  }; } } });
  assert.equal(await fc.connect(), false);
  assert.equal(released, true);
  assert.equal(closed, true);
  assert.equal(fc.port, null);
});

test("cancel during connection settling releases both locks", async () => {
  const readable = new ReadableStream();
  const writable = new WritableStream();
  let closed = false;
  const fc = new FCConnection({ settleDelayMs: 500, serial: { async requestPort() { return {
    async open() {}, readable, writable, async close() { closed = true; },
  }; } } });
  const controller = new AbortController();
  const pending = fc.connect({ signal: controller.signal });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await new Promise(setImmediate);
  controller.abort();
  await rejected;
  assert.equal(closed, true);
  assert.equal(readable.locked, false);
  assert.equal(writable.locked, false);
});
