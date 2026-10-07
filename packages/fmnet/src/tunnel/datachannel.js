import { logger } from '../logger.js';

export default class DataChannel {
  constructor(sessionId, peerDeviceId, raw, metadata, closeFn) {
    this.sessionId = sessionId;
    this.peerDeviceId = peerDeviceId;
    this.raw = raw;
    this.metadata = metadata || {}
    this.closeFn = closeFn;
    this._onclose = null
    this._onerror = null
    raw.binaryType = "arraybuffer";
  }

  toBuffer(data) {
    if (Buffer.isBuffer(data)) return data;

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }

    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }

    throw new Error(`Unsupported data type: ${data?.constructor?.name}`);
  }

  send(data) {
    this.raw.send(this.toBuffer(data));
  }

  onData(fn) {
    this.raw.onmessage = ev => fn(this.toBuffer(ev.data));
  }

  onClose(fn) {
    if (this._onclose) {
      this.raw.removeEventListener("close", this._onclose)
    }
    this._onclose = fn
    this.raw.addEventListener("close", this._onclose)
  }

  onError(fn) {
    if (this._onerror) {
      this.raw.removeEventListener("error", this._onerror)
    }
    this._onerror = fn
    this.raw.addEventListener("error", this._onerror)
  }

  close() {
    // this.closeFn();
    this.raw.close()
    logger.debug("Datachannel closed")
  }
}
