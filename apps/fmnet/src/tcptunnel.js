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
    s.notifyPeerOnClose = notifyPeer
    try {
      s.socket.close()
    } catch { }
    try {
      s.session.dc.close()
    } catch { }
  }

  addSession(session, socket) {
    this.sessions.set(session.sessionId, { session, socket, notifyPeerOnClose: true })
  }

  removeSession(sessionId) {
    this.sessions.delete(sessionId)
  }
}

export class TcpTunnelIngress extends TcpTunnel {
  constructor(tcpAdapter, dcm, host, port, localPort) {
    super(tcpAdapter, dcm)
    this.host = host
    this.port = port
    this.localPort = localPort
  }


  async listen() {
    return await this.tcpAdapter.listen("127.0.0.1", this.localPort, async server => {
      server.pause()
      const session = await this.dcm.open({
        host: this.host,
        port: this.port,
      })
      this.dcm.onControlMessage(session.sessionId, message => {
        switch (message.type) {
          case "socketConnected":
            server.resume()
            break
          case "socketError":
            this.closeSession(session.sessionId, false)
            console.error("Client Socket error")
            break
          case "socketClosed":
            this.closeSession(session.sessionId, false)
            break
        }
      })

      this.addSession(session, server)
      // logger.debug(`}}} 7 ${await this.getDeviceId()} session opened sessoinId: ${session.sessionId} tunnels.sessio add socket tunnelId: ${tunnelId}`)
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
        dc.send(d)
      })
      dc.onData(d => {
        server.write(d)
      })
    })
  }
}


export class TcpTunnelEgress extends TcpTunnel {

  start() {
    this.dcm.listen(async session => {
      const { sessionId } = session
      // logger.debug(`}}} 8 ${await this.getDeviceId()} session accepted sessionId:${sessionId} tunnelId: ${tunnelId}`)
      const { host, port } = session.metadata

      this.dcm.onControlMessage(session.sessionId, message => {
        switch (message.type) {
          case "socketError":
            this.closeSession(session.sessionId, false)
            console.error("Client Socket error")
            break
          case "socketClosed":
            this.closeSession(session.sessionId, false)
            break
        }
      })
      const dc = session.dc
      let client
      try {
        client = await this.tcpAdapter.connect(host, port)
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
        dc.send(d)
      })

      dc.onData(d => {
        client.write(d)
      })
    })
  }
}