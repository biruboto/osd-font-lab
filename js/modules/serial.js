// js/modules/serial.js

// MSP Protocol Constants
const MSP_API_VERSION = 1;
const MSP_FC_VARIANT = 2;
const MSP_FC_VERSION = 3;
const MSP_BOARD_INFO = 4;
const MSP_BUILD_INFO = 5;
const MSP_OSD_CONFIG = 84;
const MSP_OSD_CHAR_WRITE = 87; // For writing OSD characters
const MSP_DISPLAYPORT = 182; // Different command - for DisplayPort

export class FCConnection {
  constructor() {
    this.port = null;
    this.writer = null;
    this.reader = null;
    this.connected = false;
  }

  async connect() {
    if (!navigator.serial) {
      throw new Error("Web Serial API not supported");
    }

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });

      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.connected = true;

      // Wait for connection to stabilize and FC to be ready
      await new Promise((r) => setTimeout(r, 500));

      return true;
    } catch (err) {
      console.error("Connection error:", err);
      return false;
    }
  }

  async disconnect() {
    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.writer) {
        await this.writer.close();
        this.writer.releaseLock();
        this.writer = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (e) {
      console.warn("Error during disconnect:", e);
    } finally {
      this.connected = false;
    }
  }

  async sendMsp(cmd, payload = []) {
    if (!this.connected) throw new Error("Not connected");

    const size = payload.length;
    let checksum = 0;

    checksum ^= size;
    checksum ^= cmd;
    for (const byte of payload) {
      checksum ^= byte;
    }

    const buffer = new Uint8Array(6 + size);
    buffer.set([36, 77, 60]); // $M<
    buffer[3] = size;
    buffer[4] = cmd;
    if (size > 0) {
      buffer.set(payload, 5);
    }
    buffer[5 + size] = checksum;

    await this.writer.write(buffer);
  }

  async readMspResponse(expectedCmd) {
    const HEADER_STATE = 0;
    const M_STATE = 1;
    const DIR_STATE = 2;
    const SIZE_STATE = 3;
    const CMD_STATE = 4;
    const DATA_STATE = 5;
    const CRC_STATE = 6;

    let state = HEADER_STATE;
    let size = 0;
    let cmd = 0;
    let data = new Uint8Array(0);
    let bytesRead = 0;
    let checksum = 0;

    const TIMEOUT_MS = 5000;
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        throw new Error(`Timeout waiting for MSP command ${expectedCmd}`);
      }

      const { value, done } = await this.reader.read();
      if (done) throw new Error("Stream closed");

      for (const byte of value) {
        switch (state) {
          case HEADER_STATE:
            if (byte === 36) state = M_STATE; // $
            break;
          case M_STATE:
            if (byte === 77) state = DIR_STATE; // M
            else state = HEADER_STATE;
            break;
          case DIR_STATE:
            if (byte === 62) state = SIZE_STATE; // >
            else if (byte === 33) {
              state = HEADER_STATE;
              throw new Error("MSP Error (!) received");
            } else state = HEADER_STATE;
            break;
          case SIZE_STATE:
            size = byte;
            checksum = byte;
            state = CMD_STATE;
            break;
          case CMD_STATE:
            cmd = byte;
            checksum ^= byte;
            state = DATA_STATE;
            data = new Uint8Array(size);
            bytesRead = 0;
            if (size === 0) state = CRC_STATE;
            break;
          case DATA_STATE:
            if (bytesRead < size) {
              data[bytesRead++] = byte;
              checksum ^= byte;
            }
            if (bytesRead === size) {
              state = CRC_STATE;
            }
            break;
          case CRC_STATE:
            if (checksum === byte) {
              if (cmd === expectedCmd) {
                return data;
              } else {
                state = HEADER_STATE;
              }
            } else {
              state = HEADER_STATE;
            }
            break;
        }
      }
    }
  }

  async checkConnection() {
    try {
      await this.sendMsp(MSP_API_VERSION);
      await this.readMspResponse(MSP_API_VERSION);

      await this.sendMsp(MSP_FC_VARIANT);
      const variantData = await this.readMspResponse(MSP_FC_VARIANT);
      const variant = String.fromCharCode(...variantData).replace(/\0/g, "");

      await this.sendMsp(MSP_FC_VERSION);
      const versionData = await this.readMspResponse(MSP_FC_VERSION);
      const version = `${versionData[0]}.${versionData[1]}.${versionData[2]}`;

      console.log(`Connected to ${variant} ${version}`);
      return true;
    } catch (e) {
      console.error("Check connection failed:", e);
      return false;
    }
  }

  async checkOSD() {
    try {
      await this.sendMsp(MSP_OSD_CONFIG);
      const data = await this.readMspResponse(MSP_OSD_CONFIG);

      if (data.length < 1) return false;

      const flags = data[0];
      const isMax7456FontDeviceDetected = (flags & 0x20) !== 0;

      if (!isMax7456FontDeviceDetected) {
        throw new Error("OSD Chip not detected. Please connect a battery.");
      }

      return true;
    } catch (e) {
      console.warn("OSD Check failed:", e);
      throw e;
    }
  }

  async uploadFont(fontData, progressCallback) {
    for (let i = 0; i < 256; i++) {
      const charData = fontData.slice(i * 54, (i + 1) * 54);
      if (charData.length !== 54) {
        throw new Error(`Invalid character data length for char ${i}: ${charData.length}`);
      }

      let retries = 3;
      let success = false;

      while (retries > 0 && !success) {
        try {
          const payload = [i, ...charData];
          await this.sendMsp(MSP_OSD_CHAR_WRITE, payload);
          await this.readMspResponse(MSP_OSD_CHAR_WRITE);
          success = true;
        } catch (e) {
          retries--;
          if (retries > 0) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      }

      if (!success) {
        throw new Error(`Failed to write character ${i} after retries`);
      }

      if (i < 255) {
        await new Promise((r) => setTimeout(r, 15));
      }

      if (progressCallback) progressCallback(i + 1, 256);
    }

    return true;
  }
}
