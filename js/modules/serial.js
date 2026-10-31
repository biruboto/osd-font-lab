// MSP v1 transport for analog OSD font uploads.
const MSP_API_VERSION = 1;
const MSP_FC_VARIANT = 2;
const MSP_FC_VERSION = 3;
const MSP_OSD_CONFIG = 84;
const MSP_OSD_CHAR_WRITE = 87;

function serialError(message, code) {
  return Object.assign(new Error(message), { code });
}

function pause(ms, signal) {
  signal?.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class FCConnection {
  constructor({
    serial = globalThis.navigator?.serial,
    responseTimeoutMs = 5000,
    settleDelayMs = 500,
    writeIntervalMs = 15,
    retryDelayMs = 100,
  } = {}) {
    this.serial = serial;
    this.responseTimeoutMs = responseTimeoutMs;
    this.settleDelayMs = settleDelayMs;
    this.writeIntervalMs = writeIntervalMs;
    this.retryDelayMs = retryDelayMs;
    this.port = null;
    this.writer = null;
    this.reader = null;
    this.connected = false;
    this.receiveBuffer = new Uint8Array();
    this.requestQueue = Promise.resolve();
    this.session = 0;
    this.activeOperation = null;
  }

  async connect({ signal } = {}) {
    if (!this.serial) throw new Error("Web Serial API not supported");
    if (this.port) throw new Error("Already connected");
    signal?.throwIfAborted();
    try {
      this.port = await this.serial.requestPort();
      signal?.throwIfAborted();
      await this.port.open({ baudRate: 115200 });
      signal?.throwIfAborted();
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.receiveBuffer = new Uint8Array();
      this.requestQueue = Promise.resolve();
      this.session++;
      this.connected = true;
      await pause(this.settleDelayMs, signal);
      return true;
    } catch (err) {
      await this.disconnect();
      if (signal?.aborted) throw signal.reason;
      console.error("Connection error:", err);
      return false;
    }
  }

  invalidate(error) {
    this.connected = false;
    this.receiveBuffer = new Uint8Array();
    // Preserve the useful timeout/abort reason before releaseLock rejects read().
    this.activeOperation?.reject(error);
    const reader = this.reader;
    this.reader = null;
    try {
      reader?.releaseLock();
    } catch (err) {
      console.warn("Error releasing serial reader:", err);
    }
  }

  async disconnect() {
    this.session++;
    this.invalidate(serialError("Serial connection closed", "MSP_DISCONNECTED"));
    const writer = this.writer;
    const port = this.port;
    this.writer = null;
    this.port = null;
    // Every resource gets its cleanup attempt even if another step fails.
    try {
      writer?.releaseLock();
    } catch (err) {
      console.warn("Error releasing serial writer:", err);
    }
    try {
      await port?.close();
    } catch (err) {
      console.warn("Error closing serial port:", err);
    }
  }

  async withDeadline(work, { signal, timeoutMs = this.responseTimeoutMs } = {}) {
    signal?.throwIfAborted();
    if (this.activeOperation) throw new Error("Another MSP operation is in progress");
    let timer;
    let abort;
    const operation = {};
    const interrupted = new Promise((resolve, reject) => {
      operation.reject = reject;
      timer = setTimeout(() => this.invalidate(serialError("Timeout waiting for flight controller response", "MSP_TIMEOUT")), timeoutMs);
      abort = () => this.invalidate(signal.reason);
      signal?.addEventListener("abort", abort, { once: true });
    });
    this.activeOperation = operation;
    try {
      return await Promise.race([work(), interrupted]);
    } catch (err) {
      // Retry a complete negative acknowledgement, never an ambiguous late ACK.
      if (err?.code !== "MSP_REJECTED") this.invalidate(err);
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (this.activeOperation === operation) this.activeOperation = null;
    }
  }

  request(cmd, payload = [], options = {}) {
    const session = this.session;
    const data = Uint8Array.from(payload);
    const pending = this.requestQueue.then(() => {
      if (!this.connected || session !== this.session) throw serialError("Not connected", "MSP_DISCONNECTED");
      return this.withDeadline(async () => {
        await this.sendMsp(cmd, data);
        if (!this.connected || session !== this.session) throw serialError("Serial connection closed", "MSP_DISCONNECTED");
        return this.readResponse(cmd);
      }, options);
    });
    this.requestQueue = pending.catch(() => {});
    return pending;
  }

  async sendMsp(cmd, payload = []) {
    if (!this.connected || !this.writer) throw serialError("Not connected", "MSP_DISCONNECTED");
    if (!Number.isInteger(cmd) || cmd < 0 || cmd > 255 || payload.length > 255) {
      throw new Error("Invalid MSP v1 command or payload length");
    }
    const buffer = new Uint8Array(6 + payload.length);
    buffer.set([36, 77, 60, payload.length, cmd]); // $M<
    buffer.set(payload, 5);
    let checksum = payload.length ^ cmd;
    for (const byte of payload) checksum ^= byte;
    buffer[5 + payload.length] = checksum;
    await this.writer.write(buffer);
  }

  takeResponse(expectedCmd) {
    while (this.receiveBuffer.length >= 3) {
      const bytes = this.receiveBuffer;
      let start = 0;
      while (start <= bytes.length - 3 && !(bytes[start] === 36 && bytes[start + 1] === 77 && (bytes[start + 2] === 62 || bytes[start + 2] === 33))) start++;
      if (start > 0) this.receiveBuffer = bytes.slice(start);
      const frame = this.receiveBuffer;
      if (frame.length < 6) return null;
      const size = frame[3];
      const cmd = frame[4];
      const length = size + 6;
      if (frame.length < length) return null;
      let checksum = size ^ cmd;
      for (let i = 5; i < length - 1; i++) checksum ^= frame[i];
      if (checksum !== frame[length - 1]) {
        this.receiveBuffer = frame.slice(1);
        continue;
      }
      this.receiveBuffer = frame.slice(length);
      if (cmd !== expectedCmd) continue;
      if (frame[2] === 33) throw serialError(`Flight controller rejected MSP command ${cmd}`, "MSP_REJECTED");
      return frame.slice(5, length - 1);
    }
    return null;
  }

  async readResponse(expectedCmd) {
    if (!this.reader) throw serialError("Serial reader unavailable", "MSP_DISCONNECTED");
    const reader = this.reader;
    while (true) {
      const response = this.takeResponse(expectedCmd);
      if (response !== null) return response;
      const { value, done } = await reader.read();
      if (done) throw serialError("Serial stream closed", "MSP_DISCONNECTED");
      const joined = new Uint8Array(this.receiveBuffer.length + value.length);
      joined.set(this.receiveBuffer);
      joined.set(value, this.receiveBuffer.length);
      this.receiveBuffer = joined;
    }
  }

  readMspResponse(expectedCmd, options = {}) {
    return this.withDeadline(() => this.readResponse(expectedCmd), options);
  }

  async checkConnection(options = {}) {
    await this.request(MSP_API_VERSION, [], options);
    const variantData = await this.request(MSP_FC_VARIANT, [], options);
    const versionData = await this.request(MSP_FC_VERSION, [], options);
    if (versionData.length < 3) throw new Error("Invalid flight controller version response");
    const variant = String.fromCharCode(...variantData).replace(/\0/g, "");
    console.log(`Connected to ${variant} ${versionData[0]}.${versionData[1]}.${versionData[2]}`);
    return true;
  }

  async checkOSD(options = {}) {
    const data = await this.request(MSP_OSD_CONFIG, [], options);
    if (!data.length) throw new Error("Invalid OSD configuration response");
    if (!(data[0] & 0x20)) throw new Error("OSD Chip not detected. Please connect a battery.");
    return true;
  }

  async uploadFont(fontData, progressCallback, { signal } = {}) {
    if (!(fontData instanceof Uint8Array) || fontData.length !== 256 * 54) {
      throw new Error("Font upload expects exactly 256 characters of 54 bytes");
    }
    const snapshot = new Uint8Array(fontData);
    for (let i = 0; i < 256; i++) {
      signal?.throwIfAborted();
      const payload = [i, ...snapshot.subarray(i * 54, (i + 1) * 54)];
      for (let attempt = 0; ; attempt++) {
        try {
          await this.request(MSP_OSD_CHAR_WRITE, payload, { signal });
          break;
        } catch (err) {
          if (err?.code !== "MSP_REJECTED" || attempt >= 2) throw err;
          await pause(this.retryDelayMs, signal);
        }
      }
      progressCallback?.(i + 1, 256);
      if (i < 255) await pause(this.writeIntervalMs, signal);
    }
    return true;
  }
}
