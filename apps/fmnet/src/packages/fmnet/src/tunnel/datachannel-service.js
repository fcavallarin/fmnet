
import DataChannelManager from './datachannel-manager.js'
import { logger } from '../logger.js';


export class DataChannelService {
  constructor(sept, rtc, onAccept, onClose) {
    this.sept = sept;
    this.rtc = rtc;
    this.onAccept = onAccept
    this.onClose = id => {
      this.sessions.delete(id)
      if (onClose) {
        onClose(id)
      }
    }
    this.sessions = new Map()
    this.pendingIce = new Map();

    this.rtcConfig = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
      ],
    };

    sept.register("datachannel", ev => {
      switch (ev.stage) {
        case "offer":
          return this.onOffer(ev)
        case "answer":
          return this.onAnswer(ev)
        case "ice":
          return this.onIce(ev)
      }
      throw new Error(`Unknown datachannel stage ${ev.stage}`)
    });

  }

  static async create(sept, rtc, onAccept, onClose) {
    const i = new this(sept, rtc, onAccept, onClose)
    i.deviceId = await sept.getDeviceId()
    return i.deviceId ? i : null
  }

  async connect(targetDeviceId, type, metadata = {}, timeout = 30) {

    const deviceConnectionId = `${type}:${targetDeviceId}`
    const existingSession = this.sessions.get(deviceConnectionId)
    if (existingSession) {
      return existingSession.dcm
    }
    const pc = new this.rtc.RTCPeerConnection(this.rtcConfig);

    pc.onicecandidate = ev => {
      if (!ev.candidate) return;

      this.sendSignal(targetDeviceId, "ice", {
        deviceConnectionId,
        candidate: ev.candidate.toJSON(),
      });
    };

    const dc = pc.createDataChannel("fmnet-dc-control", {
      ordered: true,
    });

    dc.onclose = () => {
      pc.close()
    }

    this.sessions.set(deviceConnectionId, { pc, dc, dcm: null, metadata })

    const channelPromise = new Promise((resolve, reject) => {
      let connectOk = false
      const error = err => {
        if (connectOk) return
        clearTimeout(tm)
        dc.removeEventListener("error", error)
        reject(err)
      }
      const tm = setTimeout(() => {
        dc.removeEventListener("error", error)
        if (!connectOk) {
          dc.close();
          pc.close();
          this.sessions.delete(deviceConnectionId);
          reject("connection timeout")
        }
      }, timeout * 1000)

      dc.onopen = () => {
        connectOk = true
        clearTimeout(tm)
        dc.removeEventListener("error", error)
        const session = this.sessions.get(deviceConnectionId)
        session.dcm = new DataChannelManager(
          deviceConnectionId,
          type,
          pc,
          dc,
          targetDeviceId,
          metadata,
          this.onClose
          // () => {
          //   dc.close();
          //   pc.close();
          //   this.sessions.delete(deviceConnectionId);
          // }
        )
        resolve(session.dcm)
      };

      dc.addEventListener("error", error)
    });


    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await this.sendSignal(targetDeviceId, "offer", {
      deviceConnectionId,
      type,
      description: pc.localDescription,
      metadata
    });

    return channelPromise
  }

  async onOffer(ev) {
    const { deviceConnectionId, type, description, fromDeviceId, metadata } = ev;

    const pc = new this.rtc.RTCPeerConnection(this.rtcConfig);
    this.sessions.set(deviceConnectionId, { pc, dc: null, type, metadata });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        pc.close()
      }
    }

    pc.onicecandidate = ev => {
      if (!ev.candidate) return;

      this.sendSignal(fromDeviceId, "ice", {
        deviceConnectionId,
        candidate: ev.candidate.toJSON(),
        metadata
      });
    };

    pc.ondatachannel = ev => {
      const dc = ev.channel;
      dc.onclose = () => {
        pc.close()
      }
      const session = this.sessions.get(deviceConnectionId);
      session.dc = dc;
      session.dcm = new DataChannelManager(
        deviceConnectionId,
        session.type,
        pc,
        dc,
        fromDeviceId,
        metadata,
        this.onClose
        // () => {
        //   dc.close();
        //   pc.close();
        //   this.sessions.delete(deviceConnectionId);
        // }
      )
      this.onAccept(session.dcm)
    };

    await pc.setRemoteDescription(description);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await this.sendSignal(fromDeviceId, "answer", {
      deviceConnectionId,
      description: pc.localDescription,
    });

    await this.flushPendingIce(deviceConnectionId);
  }

  async onAnswer(ev) {
    const { deviceConnectionId, description } = ev;

    const session = this.sessions.get(deviceConnectionId);
    if (!session) return;

    await session.pc.setRemoteDescription(description);
    await this.flushPendingIce(deviceConnectionId);
  }

  async onIce(ev) {
    const { deviceConnectionId, candidate } = ev;

    const session = this.sessions.get(deviceConnectionId);

    if (!session || !session.pc.remoteDescription) {
      if (!this.pendingIce.has(deviceConnectionId)) {
        this.pendingIce.set(deviceConnectionId, []);
      }

      this.pendingIce.get(deviceConnectionId).push(candidate);
      return;
    }

    await session.pc.addIceCandidate(
      new this.rtc.RTCIceCandidate(candidate)
    );
  }

  async flushPendingIce(deviceConnectionId) {
    const session = this.sessions.get(deviceConnectionId);
    if (!session) return;

    const pending = this.pendingIce.get(deviceConnectionId) ?? [];
    this.pendingIce.delete(deviceConnectionId);

    for (const candidate of pending) {
      await session.pc.addIceCandidate(
        new this.rtc.RTCIceCandidate(candidate)
      );
    }
  }

  async sendSignal(toDeviceId, stage, payload) {
    await this.sept.sendEvent(
      "datachannel",
      {
        ...payload,
        fromDeviceId: this.deviceId,
        toDeviceId,
        stage,
      }
      , [toDeviceId]);
  }
}