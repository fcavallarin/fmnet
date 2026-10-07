import { logger } from './logger.js';

class TcpTunnel {
  constructor(tcpAdapter, dcm) {
    this.tcpAdapter = tcpAdapter
    this.dcm = dcm
    this.sessions = new Map()
  }
  closeSession(sessionId, notifyPeer = true) {
    const s = this.sessions.get(sessionId)
    if (!s) {
      throw new Error("Session not found")
    }
    s.isClosing = true
    s.notifyPeerOnClose = notifyPeer
    try {
      s.socket.close()
    } catch { }
    try {
      s.session.dc.close()
    } catch { }
  }

  addSession(session, socket) {
    this.sessions.set(session.sessionId, { session, socket, notifyPeerOnClose: true, isClosing: false })
  }

  removeSession(sessionId) {
    this.sessions.delete(sessionId)
  }

  closeAllSessions(notifyPeer = true) {
    for (const [sessionId, session] of this.sessions) {
      this.closeSession(sessionId, notifyPeer)
    }
  }
}

export class TcpTunnelIngress extends TcpTunnel {
  constructor(tcpAdapter, dcm, host, port, localPort) {
    super(tcpAdapter, dcm)
    this.host = host
    this.port = port
    this.localPort = localPort
    this.role = "ingress"
    this.server = null
  }

  async close() {
    this.closeAllSessions()
    await this.server.close()
  }

  async listen() {
    this.server = await this.tcpAdapter.listen("127.0.0.1", this.localPort, async server => {
      server.pause()
      const sessionId = this.dcm.create()
      this.dcm.onControlMessage(sessionId, message => {
        switch (message.type) {
          case "socketConnected":
            server.resume()
            logger.debug(`ingress socket resumed`)
            this.dcm.sendControlMessage(sessionId, {
              type: "socketConnected"
            })
            break
          case "socketError":
            this.closeSession(sessionId, false)
            console.error("Client Socket error")
            break
          case "socketClosed":
            this.closeSession(sessionId, false)
            break
        }
      })

      const session = await this.dcm.open(sessionId, {
        host: this.host,
        port: this.port,
      })

      this.addSession(session, server)
      logger.debug(`dcm.opne() resolved`)
      const dc = session.dc

      server.onClose(() => {
        const s = this.sessions.get(session.sessionId)
        logger.debug("Server closed")
        if (s.notifyPeerOnClose) {
          this.dcm.sendControlMessage(session.sessionId, {
            type: "socketClosed"
          })
        }
        this.removeSession(session.sessionId)
      })

      dc.onClose(() => {
        logger.debug("Server DC closed")
        server.close()
      })
      server.onData(d => {
        if (!session.isClosing) {
          logger.debug(`ingress socket got data size: ${d.length}`)
          dc.send(d)
        }
      })
      server.onError(err => {
        if (err.code === "ECONNRESET") {
          logger.debug(`Server connection reset`)
        }
        session.dc.close()
      })
      dc.onData(d => {
        if (!session.isClosing) {
          logger.debug(`ingress DC got data size: ${d.length}`)
          server.write(d)
        }
      })
    })
    return this.server
  }
}


export class TcpTunnelEgress extends TcpTunnel {
  constructor(tcpAdapter, dcm) {
    super(tcpAdapter, dcm)
    this.role = "egress"
  }

  async close() {
    this.closeAllSessions()
  }

  start() {
    this.dcm.listen(async session => {
      let client
      const { sessionId } = session
      // logger.debug(`}}} 8 ${await this.getDeviceId()} session accepted sessionId:${sessionId} tunnelId: ${tunnelId}`)
      logger.debug(`egress tcptun got new session ${sessionId}`)
      const { host, port } = session.metadata

      this.dcm.onControlMessage(session.sessionId, message => {
        switch (message.type) {
          case "socketConnected":
            logger.debug(`egress socket resumed`)
            client.resume()
            break
          case "socketError":
            this.closeSession(session.sessionId, false)
            console.error("Client Socket error")
            break
          case "socketClosed":
            logger.debug(`Clogins session as requested by controlDC ${session.sessionId}`)
            this.closeSession(session.sessionId, false)
            break
        }
      })
      const dc = session.dc

      try {
        client = await this.tcpAdapter.connect(host, port)
        client.pause()
        logger.debug(`egress socket connected (socket paused)`)
        // logger.debug(`}}} 9 ${await this.getDeviceId()} tcp connect OK sessionId:${sessionId} tunnelId: ${tunnelId}`)
        this.dcm.sendControlMessage(sessionId, {
          type: "socketConnected"
        })
      } catch (err) {
        this.dcm.sendControlMessage(sessionId, {
          type: "socketError",
          errorMessage: err.code ?? "connection_error"
        })

        try {
          session.dc.close()
        } catch { }
        return
      }

      this.addSession(session, client)
      // logger.debug(`}}} 10 ${await this.getDeviceId()} tunnels.session add socket sessionId:${sessionId} tunnelId: ${tunnelId}`)
      client.onClose(() => {
        const s = this.sessions.get(session.sessionId)
        logger.debug("Client closed")
        if (s.notifyPeerOnClose) {
          this.dcm.sendControlMessage(session.sessionId, {
            type: "socketClosed"
          })
        }
        this.removeSession(session.sessionId)
      })

      dc.onClose(() => {
        logger.debug("Client DC closed")
        client.close()
      })

      client.onData(d => {
        if (!session.isClosing) {
          logger.debug(`egress socket got data size: ${d.length}`)
          dc.send(d)
        }
      })

      client.onError(err => {
        // if (err.code === "ECONNRESET") {
          logger.debug(`Client connection error ${err.code}`)
          session.dc.close()
        // }
      })

      dc.onData(d => {
        if (!session.isClosing) {
          logger.debug(`egress DC got data size: ${d.length}`)
          client.write(d)
        }
      })
    })
  }
}