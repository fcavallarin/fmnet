
import DataChannelManager from './datachannel-manager.js'
import { logger } from '../logger.js';


export class DataChannelService {
  constructor(sept, rtc, onAccept) {
    this.sept = sept;
    this.rtc = rtc;
    this.onAccept = onAccept
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

  static async create(sept, rtc, onAccept) {
    const i = new this(sept, rtc, onAccept)
    i.deviceId = await sept.getDeviceId()
    return i.deviceId ? i : null
  }

  makeSessionId() {
    return [
      "fmnet",
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
      Math.random().toString(36).slice(2),
    ].join("-");
  }

  async connect(targetDeviceId, type, metadata = {}, timeout = 30) {

    const sessionId = `${type}:${targetDeviceId}`
    const existingSession = this.sessions.get(sessionId)
    if (existingSession) {
      return existingSession.dcm
    }
    const pc = new this.rtc.RTCPeerConnection(this.rtcConfig);

    pc.onicecandidate = ev => {
      if (!ev.candidate) return;

      this.sendSignal(targetDeviceId, "ice", {
        sessionId,
        candidate: ev.candidate.toJSON(),
      });
    };

    const dc = pc.createDataChannel("fmnet-dc-control", {
      ordered: true,
    });

    dc.onclose = () => {
      pc.close()
    }

    this.sessions.set(sessionId, { pc, dc, dcm:null, metadata })

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
          this.sessions.delete(sessionId);
          reject("connection timeout")
        }
      }, timeout * 1000)

      dc.onopen = () => {
        connectOk = true
        clearTimeout(tm)
        dc.removeEventListener("error", error)
        const session = this.sessions.get(sessionId)
        session.dcm = new DataChannelManager(
          sessionId,
          type,
          pc,
          dc,
          targetDeviceId,
          metadata,
          // () => {
          //   dc.close();
          //   pc.close();
          //   this.sessions.delete(sessionId);
          // }
        )
        resolve(session.dcm)
      };

      dc.addEventListener("error", error)
    });


    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await this.sendSignal(targetDeviceId, "offer", {
      sessionId,
      type,
      description: pc.localDescription,
      metadata
    });

    return channelPromise
  }

  async onOffer(ev) {
    const { sessionId, type, description, fromDeviceId, metadata } = ev;

    const pc = new this.rtc.RTCPeerConnection(this.rtcConfig);
    this.sessions.set(sessionId, { pc, dc: null, type, metadata });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        pc.close()
      }
    }

    pc.onicecandidate = ev => {
      if (!ev.candidate) return;

      this.sendSignal(fromDeviceId, "ice", {
        sessionId,
        candidate: ev.candidate.toJSON(),
        metadata
      });
    };

    pc.ondatachannel = ev => {
      const dc = ev.channel;
      dc.onclose = () => {
        pc.close()
      }
      const session = this.sessions.get(sessionId);
      session.dc = dc;
      session.dcm = new DataChannelManager(
        sessionId,
        session.type,
        pc,
        dc,
        fromDeviceId,
        metadata,
        // () => {
        //   dc.close();
        //   pc.close();
        //   this.sessions.delete(sessionId);
        // }
      )
      this.onAccept(session.dcm)
    };

    await pc.setRemoteDescription(description);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await this.sendSignal(fromDeviceId, "answer", {
      sessionId,
      description: pc.localDescription,
    });

    await this.flushPendingIce(sessionId);
  }

  async onAnswer(ev) {
    const { sessionId, description } = ev;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    await session.pc.setRemoteDescription(description);
    await this.flushPendingIce(sessionId);
  }

  async onIce(ev) {
    const { sessionId, candidate } = ev;

    const session = this.sessions.get(sessionId);

    if (!session || !session.pc.remoteDescription) {
      if (!this.pendingIce.has(sessionId)) {
        this.pendingIce.set(sessionId, []);
      }

      this.pendingIce.get(sessionId).push(candidate);
      return;
    }

    await session.pc.addIceCandidate(
      new this.rtc.RTCIceCandidate(candidate)
    );
  }

  async flushPendingIce(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const pending = this.pendingIce.get(sessionId) ?? [];
    this.pendingIce.delete(sessionId);

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