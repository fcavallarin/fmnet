import wrtc from "@roamhq/wrtc";

import net from "node:net";

export class TCPAdapter {
  async connect(host, port, timeout = 10) {
    const socket = net.connect(port, host);

    return new Promise((resolve, reject) => {
      const tm = setTimeout(() => {
        socket.destroy();
        reject(new Error("tcp connection timeout"));
      }, timeout * 1000);

      socket.once("connect", () => {
        clearTimeout(tm);
        resolve(new TCPSocket(socket));
      });

      socket.once("error", err => {
        clearTimeout(tm);
        socket.destroy();
        reject(err);
      });
    });
  }

  async listen(host, port, onAccept) {
    const server = net.createServer(socket => {
      onAccept(new TCPSocket(socket));
    });

    return new Promise((resolve, reject) => {
      server.once("error", reject);

      server.listen(port, host, () => {
        server.off("error", reject);
        resolve(new TCPServer(server));
      });
    });
  }
}

class TCPServer {
  constructor(raw) {
    this.raw = raw;
  }

  close() {
    this.raw.close();
  }
}

class TCPSocket {
  constructor(raw) {
    this.raw = raw;
    this._ondata = null;
    this._onclose = null;
    this._onerror = null;
  }

  write(data) {
    return this.raw.write(data);
  }

  pause() {
    return this.raw.pause()
  }

  resume() {
    return this.raw.resume()
  }

  onData(fn) {
    if (this._ondata) this.raw.off("data", this._ondata);
    this._ondata = fn;
    this.raw.on("data", this._ondata);
  }

  onClose(fn) {
    if (this._onclose) this.raw.off("close", this._onclose);
    this._onclose = fn;
    this.raw.on("close", this._onclose);
  }

  onError(fn) {
    if (this._onerror) this.raw.off("error", this._onerror);
    this._onerror = fn;
    this.raw.on("error", this._onerror);
  }

  close() {
    this.raw.end();
  }
}

export const webRTCAdapter = {
  RTCPeerConnection: wrtc.RTCPeerConnection,
  RTCSessionDescription: wrtc.RTCSessionDescription,
  RTCIceCandidate: wrtc.RTCIceCandidate,
};