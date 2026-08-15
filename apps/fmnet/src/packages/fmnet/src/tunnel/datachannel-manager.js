import DataChannel from './datachannel.js'
import { logger } from '../logger.js';

export default class DataChannelManager {
  constructor(deviceConnectionId, type, pc, controlDc, peerDeviceId, metadata, onClose) {
    this.deviceConnectionId = deviceConnectionId
    this.type = type
    this.pc = pc
    this.controlDc = controlDc
    this.peerDeviceId = peerDeviceId
    this.metadata = metadata || {}
    this.channels = new Map()
    this.onClose = onClose

    this.controlDc.onmessage = message => {
      const { sessionId, status, metadata, message: protocolMessage } = JSON.parse(message.data)
      const session = this.channels.get(sessionId)
      switch (status) {
        case "requested": // B
          logger.debug("controlDc received 'requested'")
          this.channels.set(sessionId, {
            sessionId,
            metadata,
            status: "accepted"
          })
          this.controlDc.send(JSON.stringify({ sessionId, status: "accepted" }))
          break
        case "accepted": // A
          if (!session) {
            throw new Error("Session not found")
          }
          logger.debug("controlDc received 'accepted'")
          session.status = "ready"
          this.controlDc.send(JSON.stringify({ sessionId, status: session.status }))
          const dc = this.pc.createDataChannel(sessionId, {
            ordered: true,
            negotiated: false,
          })
          session.dc = new DataChannel(
            sessionId,
            this.peerDeviceId,
            dc,
            this.metadata,
            () => { }
          )
          session.callback(session) // @TODO return DataChannel
          break
        case "shutdown":
          logger.debug("DCM Shutdown requested")
          this.controlDc.close()
          this.pc.close()
          if (this.onClose) {
            this.onClose(this.deviceConnectionId)
          }
          break
        case "protocolMessage":
          if (!session) {
            throw new Error("Session not found2")
          }
          session.controlMessageHandler(protocolMessage)
      }

      this.pc.ondatachannel = ev => {
        const dc = ev.channel
        dc.onopen = () => {
          const sessionId = dc.label
          const session = this.channels.get(sessionId)
          session.status = "ready"
          session.dc = new DataChannel(
            sessionId,
            this.peerDeviceId,
            dc,
            this.metadata,
            () => { }
          )
          logger.debug(`Datachannel ${JSON.stringify(session)}`)
          this.handleOpen(session)
        }
      }

    }
  }

  listen(callback) {
    this.handleOpen = callback
  }

  sendControlMessage(sessionId, message) {
    this.controlDc.send(JSON.stringify({
      sessionId,
      status: "protocolMessage",
      message
    }))
  }

  onControlMessage(sessionId, fn) {
    const session = this.channels.get(sessionId)
    session.controlMessageHandler = fn
  }

  makeSessionId() {
    return [
      "fmnetdcmsess",
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
      Math.random().toString(36).slice(2),
    ].join("-");
  }

  // Do not create the sessionId in open()
  // the requester can do:
  //  const id = dcm.create()
  //  dcm.onControlMessage(id ...
  //  dcm.opne(id ...)
  //In this way the onControlMessage listener is created before the connect (no race conditions)
  create() {
    const sessionId = this.makeSessionId()
    this.channels.set(sessionId, {
      sessionId,
      status: "created",
    })
    return sessionId
  }

  open(sessionId, metadata) {
    logger.debug("creating datachannel")

    return new Promise((resolve, reject) => {
      const session = this.channels.get(sessionId)
      if (!session) {
        throw new Error("Session not found, dcm.create() has to be called before connect()")
      }
      session.metadata = metadata
      session.status = "requested"
      session.callback = resolve

      this.controlDc.send(JSON.stringify({
        sessionId,
        status: "requested",
        metadata,
      }))
    })
  }

  async close() {
    try {
      // ignore errors: contdolDc may be closed due to the peer shutdown message
      await this.controlDc.send(JSON.stringify({
        status: "shutdown"
      }))
    } catch { }
    await this.controlDc.close()
    await this.pc.close()
    if (this.onClose) {
      this.onClose(this.deviceConnectionId)
    }
  }
}
