import DataChannel from './datachannel.js'
import { logger } from '../logger.js';

export default class DataChannelManager {
  constructor(sessionId, type, pc, controlDc, peerDeviceId, metadata) {
    this.sessionId = sessionId
    this.type = type
    this.pc = pc
    this.controlDc = controlDc
    this.peerDeviceId = peerDeviceId
    this.metadata = metadata || {}
    this.channels = new Map()
    this.controlDc.onmessage = message => {
      const { sessionId, status, metadata, message: protocolMessage } = JSON.parse(message.data)
      const session = this.channels.get(sessionId)
      switch (status) {
        case "requested": // B
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
      "fmnet",
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
      Math.random().toString(36).slice(2),
    ].join("-");
  }



  open(metadata) {
    logger.debug("creating datachannel")
    const sessionId = this.makeSessionId()

    return new Promise((resolve, reject) => {
      this.channels.set(sessionId, {
        sessionId,
        metadata,
        status: "requested",
        callback: resolve
      })
      this.controlDc.send(JSON.stringify({
        sessionId,
        status: "requested",
        metadata,

      }))
    })
  }

  async close(){
    await this.controlDc.close()
    await this.pc.close()
  }
}
