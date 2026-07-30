import { SeptClient } from '@sept/client';
import { DataChannelService } from './tunnel/datachannel-service.js'
import { TcpTunnelIngress, TcpTunnelEgress } from './tcptunnel.js'
import { logger, setLogger, setLogLevel } from './logger.js';
import { IdentityStore } from './identity-store.js';
import { EventBus } from './event-bus.js';


export class FMNet {
  constructor(options) {
    this.options = options;
    this.dcSessions = new Map()
    this.tcpTunnels = new Map()
    this.eventBus = new EventBus(["message"])
    this.tcpTunnelStatus = {
      REQUESTED: "requested",
      EGRESS_RUNNING: "egressRunning",
      EGRESS_ACK: "egressAck",
      PEER_DCM_READY: "peerDcmReady"
    }
    if (options?.logger) {
      setLogger(options.logger)
    }
    if (options?.logLevel) {
      setLogLevel(options.logLevel)
    }
  }

  async run() {
    this.septClient = await SeptClient.create({
      secretKeyProvider: this.options?.secretKeyProvider,
      dataStore: this.options?.dataStore,
      restEndpoint: this.options?.restEndpoint
    })

    this.identityStore = new IdentityStore(
      this.septClient.appStorage,
      await this.septClient.getNetworkId()
    )
    this.appState = this.septClient.appStorage("fmnet:state")
    this.webRTCAdapter = this.options.webRTCAdapter
    this.tcpAdapter = this.options.tcpAdapter

    await this.registerDataChannelService()
    this.septClient.on("export.device", async deviceData => {
      if (this.options?.onExportDevice) {
        this.options.onExportDevice(deviceData)
        return
      }
    })

    this.septClient.on("policy.update", async deviceData => {
      const deviceId = await this.septClient.getDeviceId()
      if (deviceData.srcDeviceId === deviceId && deviceData.metadata.dstName) {
        await this.identityStore.set(deviceData.dstDeviceId, deviceData.metadata.dstName)
      }

      if (deviceData.dstDeviceId === deviceId && deviceData.metadata.srcName) {
        await this.identityStore.set(deviceData.srcDeviceId, deviceData.metadata.srcName)
      }
    })

    this.septClient.register(
      "message", async (data, sender, timestamp) => {
        const senderName = await this.identityStore.getByDevice(sender)
        this.eventBus.dispatch("message", {
          message: data,
          sender: senderName,
          timestamp
        })
      }
    )

    this.septClient.registerConcurrent(
      "tcptunnel.ingress", async (actionData) => {
        const { tunnelId, sessionId, status } = actionData
        await this.handleTcpTunnelIngress(tunnelId, sessionId, status)
      }
    )

    this.septClient.register(
      "tcptunnel.egress", async (actionData, senderDeviceId) => {
        const { tunnelId, host, port, sessiondId, status } = actionData
        await this.handleTcpTunnelEgress(tunnelId, host, port, sessiondId, status, senderDeviceId)
      }
    )

  }

  async handleTcpTunnelEgress(tunnelId, host, port, sessiondId, status, senderDeviceId) {

    switch (status) {
      case this.tcpTunnelStatus.REQUESTED:
        logger.debug(`}}} 2 EGRESS request tcpTunnel from ingress (add to this.tcpTunnels and send sept evt to ingress)`)
        this.tcpTunnels.set(tunnelId, {
          isReady: false,
          host,
          port,
          dcm: null
        })

        this.septClient.sendEvent("tcptunnel.ingress", { tunnelId, status: this.tcpTunnelStatus.EGRESS_ACK }, [senderDeviceId])
        break
      case this.tcpTunnelStatus.PEER_DCM_READY:
        logger.debug(`}}} 5 EGRESS got asck DC connection from ingress (update this.tcpTunnels, start egress tcp tunnel and send sept evt to ingress)`)
        const tcptun = this.tcpTunnels.get(tunnelId)
        if (!tcptun) {
          throw new Error(`Tunnel not found ${tunnelId}`)
        }
        tcptun.isReady = true
        const sess = this.dcSessions.get(sessiondId)
        tcptun.dcm = sess.dcm
        const egress = new TcpTunnelEgress(this.tcpAdapter, tcptun.dcm)
        egress.start()
        this.septClient.sendEvent("tcptunnel.ingress", { tunnelId, status: this.tcpTunnelStatus.EGRESS_RUNNING }, [senderDeviceId])
        break
    }
  }

  async handleTcpTunnelIngress(tunnelId, sessionId, status) {
    let tcptun
    switch (status) {
      case this.tcpTunnelStatus.PEER_DCM_READY:
        const sess = this.dcSessions.get(sessionId)
        if (!sess) {
          throw new Error("Session not found")
        }
        for (const tunnelId of sess.pendingTunnels) {
          tcptun = this.tcpTunnels.get(tunnelId)
          if (!tcptun) {
            throw new Error(`Tunnel not found ${tunnelId}`)
          }
          tcptun.dcm = sess.dcm
          this.septClient.sendEvent("tcptunnel.egress", {
            tunnelId,
            sessionId,
            // dcmReady: true,
            status: this.tcpTunnelStatus.PEER_DCM_READY,
          }, [sess.dcm.peerDeviceId])
        }
        sess.pendingTunnels = []
        break

      case this.tcpTunnelStatus.EGRESS_RUNNING:
        tcptun = this.tcpTunnels.get(tunnelId)
        if (!tcptun) {
          throw new Error(`Tunnel not found ${tunnelId}`)
        }
        logger.debug(`}}} 6 INGRESS got ack tcpTunnel from egress (start ingress tcp tunnel and resolve())`)
        const ingress = new TcpTunnelIngress(
          this.tcpAdapter,
          tcptun.dcm,
          tcptun.host,
          tcptun.port,
          tcptun.localPort
        )
        const server = await ingress.listen()
        tcptun.server = server
        tcptun.callback(tunnelId)
        break

      case this.tcpTunnelStatus.EGRESS_ACK:
        tcptun = this.tcpTunnels.get(tunnelId)
        if (!tcptun) {
          throw new Error(`Tunnel not found ${tunnelId}`)
        }
        logger.debug(`}}} 3 INGRESS ack tcpTunnel from egress (update this.tcpTunnels, request DC connection and set this.dcConnections)`)
        tcptun.isReady = true
        const dcm = await this.dataChannel.connect(tcptun.deviceId, "tcptun", {})

        if (this.dcSessions.has(dcm.sessionId)) {
          logger.debug("}}} 4 INGRESS DC session already exists (update this.tcpTunnels with DC ref and send sept message to egress")
          const sess = this.dcSessions.get(dcm.sessionId)
          sess.pendingTunnels.push(tunnelId)
          tcptun.dcm = dcm
          this.septClient.sendEvent("tcptunnel.egress", {
            tunnelId,
            status: this.tcpTunnelStatus.PEER_DCM_READY,
          }, [tcptun.dcm.peerDeviceId])
          return
        }
        this.dcSessions.set(dcm.sessionId, { dcm, pendingTunnels: [tunnelId] })
        break
    }
  }

  async registerDataChannelService() {
    this.dataChannel = await DataChannelService.create(
      this.septClient,
      this.webRTCAdapter,
      async dcm => {
        switch (dcm.type) {
          case "tcptun":
            logger.debug(`}}} 4 EGRESS request DC connection (add to this.dcConnections and send sept evt to ingress)`)
            this.dcSessions.set(dcm.sessiondId, { dcm })
            this.septClient.sendEvent("tcptunnel.ingress", {
              sessionId: dcm.sessionId,
              status: this.tcpTunnelStatus.PEER_DCM_READY
            }, [dcm.peerDeviceId])
            break
        }
      }
    )
  }

  async getDeviceIdsByName(deviceName) {
    return await this.identityStore.getByName(deviceName)
  }

  async getDeviceIdByName(deviceName) {
    const deviceIds = await this.getDeviceIdsByName(deviceName)
    const deviceId = deviceIds[0]
    if (deviceIds.length > 1) {
      logger.warn(`${deviceName} has more that 1 device, using the first available: ${deviceId}`)
    }
    return deviceId
  }

  async openTcpTunnel(deviceName, host, port, localPort) {
    const deviceId = await this.getDeviceIdByName(deviceName)
    const lp = localPort || port
    const localDeviceId = await this.getDeviceId()
    const tunnelId = `${localDeviceId}:${deviceId}:${host}:${port}:${lp}`
    logger.debug(`}}} 1 INGRESS request tcpTunnel (add to this.tcpTunnels and send sept evt to egress)`)

    return new Promise((resolve, reject) => {
      this.tcpTunnels.set(tunnelId, {
        deviceId,
        dcm: null,
        isReady: false,
        callback: resolve,
        host,
        port,
        localPort: lp
      })
      this.septClient.sendEvent("tcptunnel.egress", {
        tunnelId,
        status: this.tcpTunnelStatus.REQUESTED,
        host,
        port
      }, [deviceId])
    })

  }

  async closeTcpTunnel(tunnelId) {
    const t = this.tcpTunnels.get(tunnelId)
    if (!t) {
      throw new Error(`Tunnel not found`)
    }
    await t.server.close()
    await t.dcm.close()
  }


  static async create(options) {
    const i = new this(options)
    await i.run()
    return i
  }

  async bootstrap(adminName) {
    const networkId = await this.septClient.bootstrap()
    this.identityStore.setFamilyId(networkId);
    const deviceId = await this.septClient.getDeviceId()
    await this.identityStore.set(deviceId, adminName)
    await this.registerDataChannelService()
    return networkId
  };

  async getIdentityDevices(name) {
    return await this.identityStore.getByName(name)
  }

  async getDeviceIdentity(deviceId) {
    const i = await this.identityStore.getByDevice(deviceId)
    if (!i) {
      throw new Error(`Device ${deviceId} not found`)
    }
    return {
      deviceId,
      name: i
    }
  }


  async addDevice(deviceData) {
    const deviceId = await this.septClient.getDeviceId()
    const adminDevices = {}
    adminDevices[deviceId] = await this.identityStore.getByDevice(deviceId)

    const pin = await this.septClient.addDevice(
      deviceData,
      {
        identities: { ...adminDevices, [deviceData.deviceId]: deviceData.name }
      }
    )
    await this.identityStore.set(deviceData.deviceId, deviceData.name)
    return pin
  };


  async initDevice(name) {
    const deviceData = await this.septClient.initDevice();
    deviceData.name = name;
    return deviceData;
  };

  async getLocalIdentity() {
    const deviceId = await this.septClient.getDeviceId()
    return await this.getDeviceIdentity(deviceId)
  }

  on(event, handler) {
    this.eventBus.on(event, handler)
  }


  async getPairing(pin) {
    const metadata = await this.septClient.getPairing(pin)
    this.identityStore.setFamilyId(
      await this.septClient.getNetworkId()
    )
    for (const name in metadata?.identities || []) {
      await this.identityStore.set(name, metadata.identities[name])
    }
    await this.registerDataChannelService()
  };

  async sync() {
    return await this.septClient.sync()
  };

  async shareDevices(deviceId, rcpt) {
    return await this.septClient.shareDevices(deviceId, rcpt)

  };

  async relayConnect() {
    return await this.septClient.relayConnect()

  };

  async relayDisconnect() {
    return await this.septClient.relayDisconnect()
  };

  getRelayStatus() {
    return this.septClient.getWebsocketStatus()
  }

  async getDeviceGraph() {
    return await this.septClient.getDeviceGraph()
  }

  async getPolicy(srcDeviceId, dstDeviceId) {
    return await this.septClient.getPolicy(srcDeviceId, dstDeviceId)
  }

  async getDeviceId() {
    return await this.septClient.getDeviceId()
  }

  async getFamilyId() {
    return await this.septClient.getNetworkId()
  }
  async getNetworkId() {
    return await this.septClient.getNetworkId()
  }


  async getStoredActions(filters) {
    return await this.septClient.getStoredActions(filters)
  }

  async grant(srcName, dstName, action, metadata) {
    for (const s of await this.identityStore.getByName(srcName)) {
      for (const d of await this.identityStore.getByName(dstName)) {
        return await this.septClient.grant(s, d, action, metadata)
      }
    }
  }

  async revoke(srcName, dstName, action, metadata) {
    for (const s of await this.identityStore.getByName(srcName)) {
      for (const d of await this.identityStore.getByName(dstName)) {
        return await this.septClient.revoke(s, d, action, metadata)
      }
    }
  }

  async sendMessage(dstName, message) {
    const dstDevices = await this.identityStore.getByName(dstName)
    await this.septClient.sendEvent("message", message, dstDevices)
  }

  async getNewMessages() {
    const lastSequence = await this.appState.get("lastSequence")

    const filters = {
      type: "message",
      isIncoming: true
    }
    if (lastSequence) {
      filters['sequence__gt'] = lastSequence
    }
    const messages = await this.getStoredActions(filters)
    if (messages.length === 0) {
      return []
    }

    await this.appState.set(
      "lastSequence",
      Math.max(...messages.map(m => m.sequence))
    )
    const ret = []
    for (const m of messages) {
      ret.push({
        message: m.payload,
        sender: await this.identityStore.getByDevice(m.senderDeviceId),
        id: m.id,
        timestamp: m.timestamp
      })
    }
    return ret
  }

  async assertPermission(srcName, dstName, perm) {
    for (const s of await this.identityStore.getByName(srcName)) {
      for (const d of await this.identityStore.getByName(dstName)) {
        const sp = await this.getPolicy(s, d)
        if (!sp.allowedActions.includes(perm)) {
          throw new Error(`Missing ${perm} permission from ${s} to ${d}`)
        }
        const dp = await this.getPolicy(d, s)
        if (!dp.allowedActions.includes(perm)) {
          throw new Error(`Missing ${perm} permission from ${d} to ${s}`)
        }
      }
    }
  }

  async hasPermission(srcName, dstName, perm) {
    try {
      await this.assertPermission(srcName, dstName, perm)
      return true
    } catch {
      return false
    }
  }
  async grantDataChannel(srcName, dstName) {
    await this.grant(srcName, dstName, "datachannel")
    await this.grant(dstName, srcName, "datachannel")
  }

  async grantTcpTunnel(srcName, dstName) {
    await this.assertPermission(srcName, dstName, "datachannel")
    await this.grant(srcName, dstName, "tcptunnel.egress")
    await this.grant(dstName, srcName, "tcptunnel.ingress")
  }
}
