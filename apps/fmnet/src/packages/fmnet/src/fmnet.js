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
    this.eventBus = new EventBus(["message", "policy.update", "device.added", "device.invalidated", "admin.grant", "admin.revoke"])
    this.tcpTunnelStatus = {
      REQUESTED: "requested",
      EGRESS_RUNNING: "egressRunning",
      EGRESS_ACK: "egressAck",
      PEER_DCM_READY: "peerDcmReady",
      CLOSED: "closed"
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


    this.septClient.on("policy.update", async deviceData => {
      const i = await this.getLocalIdentity()
      for (const deviceName in deviceData.metadata.identities) {
        if (deviceName !== i.name) {
          for (const id of deviceData.metadata.identities[deviceName]) {
            await this.identityStore.set(id, deviceName)
          }
        }
      }
      this.eventBus.dispatch("policy.update", deviceData)
    })

    this.septClient.on("admin.grant", async deviceData => {
      const deviceId = await this.septClient.getDeviceId()
      if (deviceData.deviceId !== deviceId) {
        await this.identityStore.set(deviceData.deviceId, deviceData.metadata.deviceName)
      }

      this.eventBus.dispatch("admin.grant", deviceData)
    })

    // Device added to the network, only admins will get this event
    this.septClient.on("device.added", async deviceData => {
      await this.identityStore.set(deviceData.id, deviceData.metadata.deviceName)
      this.eventBus.dispatch("device.added", deviceData)
    })

    this.septClient.on("device.invalidated", async deviceData => {
      await this.identityStore.deleteDevice(deviceData.deviceId)
      this.eventBus.dispatch("device.invalidated", deviceData)
    })

    this.septClient.register(
      "message", async (data, sender, timestamp, eventId) => {
        const senderName = await this.identityStore.getByDevice(sender)
        await this.appState.set("unreads", cur => {
          const next = cur ? { ...cur } : {}
          if (next[sender]) {
            next[sender].push(eventId)
          } else {
            next[sender] = [eventId]
          }
          return next
        })
        this.eventBus.dispatch("message", {
          message: data,
          sender: senderName,
          timestamp,
          id: eventId
        })
      }
    )

    this.septClient.registerConcurrent(
      "tcptunnel.ingress", async (actionData) => {
        const { tunnelId, dcmId, status } = actionData
        await this.handleTcpTunnelIngress(tunnelId, dcmId, status)
      }
    )

    this.septClient.register(
      "tcptunnel.egress", async (actionData, senderDeviceId) => {
        const { tunnelId, host, port, dcmId, status } = actionData
        await this.handleTcpTunnelEgress(tunnelId, host, port, dcmId, status, senderDeviceId)
      }
    )
  }

  async handleTcpTunnelEgress(tunnelId, host, port, dcmId, status, senderDeviceId) {
    let tcptun
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
        tcptun = this.tcpTunnels.get(tunnelId)
        if (!tcptun) {
          throw new Error(`Tunnel not found ${tunnelId}`)
        }
        tcptun.isReady = true
        const sess = this.dcSessions.get(dcmId)
        if (!sess) {
          // Zombie session: it exists on the peer but not locally
          logger.debug(`Zombie dcSession (${dcmId}) .. resetting`)
          this.septClient.sendEvent(septDst, {
            tunnelId,
            status: this.tcpTunnelStatus.CLOSED,
          },
            [senderDeviceId]
          )
          return
        }
        tcptun.dcm = sess.dcm
        const egress = new TcpTunnelEgress(this.tcpAdapter, tcptun.dcm)
        tcptun.handler = egress
        egress.start()
        this.septClient.sendEvent("tcptunnel.ingress", { tunnelId, status: this.tcpTunnelStatus.EGRESS_RUNNING }, [senderDeviceId])
        break
      case this.tcpTunnelStatus.CLOSED:
        tcptun = this.tcpTunnels.get(tunnelId)
        if (!tcptun) {
          throw new Error(`Tunnel not found ${tunnelId}`)
        }
        tcptun.handler.close()
        this.tcpTunnels.delete(tunnelId)
        break
    }
  }

  async handleTcpTunnelIngress(tunnelId, dcmId, status) {
    let tcptun
    switch (status) {
      case this.tcpTunnelStatus.PEER_DCM_READY:
        const sess = this.dcSessions.get(dcmId)
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
            dcmId,
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
        tcptun.handler = ingress
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
        logger.debug(`INGRESS DC connected (${dcm.deviceConnectionId})`)

        if (this.dcSessions.has(dcm.deviceConnectionId)) {
          logger.debug("}}} 4 INGRESS DC session already exists (update this.tcpTunnels with DC ref and send sept message to egress")
          const sess = this.dcSessions.get(dcm.deviceConnectionId)
          sess.pendingTunnels.push(tunnelId)
          tcptun.dcm = dcm
          this.septClient.sendEvent("tcptunnel.egress", {
            tunnelId,
            dcmId: dcm.deviceConnectionId,
            status: this.tcpTunnelStatus.PEER_DCM_READY,
          }, [tcptun.dcm.peerDeviceId])
          return
        }
        this.dcSessions.set(dcm.deviceConnectionId, { dcm, pendingTunnels: [tunnelId] })
        break
      case this.tcpTunnelStatus.CLOSED:
        tcptun = this.tcpTunnels.get(tunnelId)
        if (!tcptun) {
          logger.debug(`Zombine tunnel ${tunnelId}.. skipping close request`)
        } else {
          await tcptun.handler.close()
        }
        this.tcpTunnels.delete(tunnelId)
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
            logger.debug(`}}} 4 EGRESS request DC connection (add to this.dcConnections (${dcm.deviceConnectionId}) and send sept evt to ingress)`)
            this.dcSessions.set(dcm.deviceConnectionId, { dcm })
            this.septClient.sendEvent("tcptunnel.ingress", {
              dcmId: dcm.deviceConnectionId,
              status: this.tcpTunnelStatus.PEER_DCM_READY
            }, [dcm.peerDeviceId])
            break
        }
      },
      async dcmId => {
        logger.debug(`DCM closed ${dcmId}`)
        this.dcSessions.delete(dcmId)
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
    if (this.tcpTunnels.has(tunnelId)) {
      throw new Error(`Tunnel already active`)
    }
    logger.debug(`}}} 1 INGRESS request tcpTunnel (add to this.tcpTunnels and send sept evt to egress)`)

    return new Promise((resolve, reject) => {
      this.tcpTunnels.set(tunnelId, {
        deviceId,
        dcm: null,
        isReady: false,
        handler: null,
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
    const septDst = t.handler.role === "ingress" ? "tcptunnel.egress" : "tcptunnel.ingress"
    this.septClient.sendEvent(septDst, {
      tunnelId,
      status: this.tcpTunnelStatus.CLOSED,
    }, [t.dcm.peerDeviceId])
    await t.handler.close()
    this.tcpTunnels.delete(tunnelId)
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
    for (const a of await this.getAdmins()) {
      adminDevices[a] = await this.identityStore.getByName(a)
    }

    const pin = await this.septClient.addDevice(
      deviceData,
      {
        deviceMetadata: {
          identities: { ...adminDevices, [deviceData.name]: [deviceData.deviceId] }
        },
        adminMetadata: {
          //identities: { [deviceData.name]: [deviceData.deviceId] }
          deviceName: deviceData.name
        }
      }
    )
    await this.identityStore.set(deviceData.deviceId, deviceData.name)
    return pin
  };

  async invalidateDevice(deviceName) {
    for (const d of await this.getIdentityDevices(deviceName)) {
      await this.septClient.invalidateDevice(d)
      await this.identityStore.deleteDevice(d)
    }
  }

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

  off(event, handler) {
    this.eventBus.off(event, handler)
  }


  async getPairing(pin) {
    const metadata = await this.septClient.getPairing(pin)
    this.identityStore.setFamilyId(
      await this.septClient.getNetworkId()
    )
    for (const name in metadata?.identities || {}) {
      for (const id of metadata.identities[name]) {
        await this.identityStore.set(id, name)
      }
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

  async checkPolicy(srcDeviceId, dstDeviceId, perm) {
    return await this.septClient.checkPolicy(srcDeviceId, dstDeviceId, perm)
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

  async getStoredActions(filters) { // @TODO rename 'actions'
    return await this.septClient.getStoredActions(filters)
  }

  async grant(srcName, dstName, actions, metadata = {}) {
    const srcDevices = await this.identityStore.getByName(srcName)
    const dstDevices = await this.identityStore.getByName(dstName)
    for (const s of srcDevices) {
      for (const d of dstDevices) {
        return await this.septClient.grant(s, d, actions, {
          identities: {
            [srcName]: srcDevices,
            [dstName]: dstDevices,
          },
          ...metadata
        })
      }
    }
  }

  async revoke(srcName, dstName, actions, metadata) {
    for (const s of await this.identityStore.getByName(srcName)) {
      for (const d of await this.identityStore.getByName(dstName)) {
        return await this.septClient.revoke(s, d, actions, metadata)
      }
    }
  }

  async grantAdmin(name) {
    const identities = await this.identityStore.list()
    for (const d of await this.identityStore.getByName(name)) {
      const metadata = {
        adminMetadata: {
          deviceName: name
        },
        devicesMetadata: {
          identities: Object.fromEntries(
            identities.map(({ name, devices }) => [name, devices])
          )
        }
      }

      await this.septClient.grantAdmin(d, metadata)
    }
  }

  async revokeAdmin(name) {
    for (const d of await this.identityStore.getByName(name)) {
      await this.septClient.revokeAdmin(d)
    }
  }

  async sendMessage(dstName, message) {
    const dstDevices = await this.identityStore.getByName(dstName)
    if (!dstDevices || dstDevices.length === 0) {
      throw new Error(`No devices associated to ${dstName}`)
    }
    await this.septClient.sendEvent("message", message, dstDevices)
  }

  async sendEvent(dstName, eventName, data) {
    const dstDevices = await this.identityStore.getByName(dstName)
    await this.septClient.sendEvent(eventName, data, dstDevices)
  }

  async getNewMessages() {  // @TODO deprecated
    const lastSequence = await this.appState.get("lastSequence")

    const filters = {
      isIncoming: true
    }
    if (lastSequence) {
      filters['sequence__gt'] = lastSequence
    }
    const messages = await this.getMessages(filters)
    if (messages.length === 0) {
      return []
    }

    await this.appState.set(
      "lastSequence",
      Math.max(...messages.map(m => m.sequence))
    )
    return messages
  }


  async getMessagesFrom(fromName, filters = {}) {
    return await this.getMessages({
      sender_device_id__in: await this.getIdentityDevices(fromName),
      ...filters
    })
  }

  async getConversationFrom(fromName) {
    const messages = await this.getMessagesFrom(fromName)

    messages.push(...(await this.getMessages({
      sender_device_id: await this.septClient.getDeviceId(),
      recipient: { device_id__in: await this.getIdentityDevices(fromName) }
    })))
    return messages.sort((a, b) => a.sequence - b.sequence)
  }


  async getMessages(filters = {}) {

    const messages = await this.getStoredActions({ type: "message", ...filters })
    if (messages.length === 0) {
      return []
    }

    const ret = []
    for (const m of messages) {
      ret.push({
        message: m.payload,
        sender: await this.identityStore.getByDevice(m.senderDeviceId),
        id: m.id,
        timestamp: m.timestamp,
        sequence: m.sequence,
        isIncoming: m.isIncoming,
        isOutgoing: m.isOutgoing
      })
    }
    return ret
  }

  setMessageAsRead = async (eventId) => {
    await this.appState.set("unreads", cur => {
      if (!cur) return {}
      for (const sender in cur) {
        const idx = cur[sender].indexOf(eventId)
        if (idx > -1) {
          cur[sender].splice(idx, 1)
          if (cur[sender].length === 0) {
            delete cur[sender]
          }
          return cur
        }
      }
      return cur
    })
  }

  getContacts = async () => {
    const graph = await this.getDeviceGraph()
    const contacts = {}
    const deviceId = await this.getDeviceId()

    if (await this.isCurrentDeviceAdmin()) {
      for (const d of await this.identityStore.list()) {
        contacts[d.name] = { unreads_number: 0, unreads: [] }
      }
    } else {
      for (const g of graph) {
        if (g.policy.allowedActions.includes("message")) {
          const did = g.dstDeviceId === deviceId ? g.srcDeviceId : g.dstDeviceId
          const i = await this.getDeviceIdentity(did)
          contacts[i.name] = { unreads_number: 0, unreads: [] }
        }
      }
    }

    // Admins can send events event without an expplicit grant
    for (const a of await this.septClient.getAdmins()) {
      const i = await this.getDeviceIdentity(a.deviceId)
      if (i.name in contacts) {
        continue
      }
      contacts[i.name] = { unreads_number: 0, unreads: [] }
    }

    const unreads = await this.appState.get("unreads")
    for (const u in unreads) {
      const i = await this.getDeviceIdentity(u)
      contacts[i.name].unreads = unreads[u]
      contacts[i.name].unreads_number = unreads[u].length
    }
    const contactList = []
    for (const c in contacts) {
      contactList.push({
        name: c,
        ...contacts[c]
      })
    }
    return contactList
  }

  async assertPermission(srcName, dstName, perm) {
    for (const s of await this.identityStore.getByName(srcName)) {
      for (const d of await this.identityStore.getByName(dstName)) {
        const sp = await this.checkPolicy(s, d, perm)
        if (!sp) {
          throw new Error(`Missing ${perm} permission from ${s} to ${d}`)
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

  async hasTcpTunnelPermission(srcName, dstName) {

    try {
      await this.assertPermission(srcName, dstName, "datachannel")
      await this.assertPermission(dstName, srcName, "datachannel")
      await this.assertPermission(srcName, dstName, "tcptunnel.egress")
      await this.assertPermission(dstName, srcName, "tcptunnel.ingress")
      return true
    } catch {
      return false
    }
  }

  async grantChat(srcName, dstName) {
    await this.grant(srcName, dstName, ["message"])
    await this.grant(dstName, srcName, ["message"])
  }

  async revokeChat(srcName, dstName) {
    await this.revoke(srcName, dstName, ["message"])
    await this.revoke(dstName, srcName, ["message"])
  }


  async grantDataChannel(srcName, dstName) {
    await this.grant(srcName, dstName, ["datachannel"])
    await this.grant(dstName, srcName, ["datachannel"])
  }

  async grantTcpTunnel(srcName, dstName) {
    await this.assertPermission(srcName, dstName, "datachannel")
    await this.assertPermission(dstName, srcName, "datachannel")
    await this.grant(srcName, dstName, ["tcptunnel.egress"])
    await this.grant(dstName, srcName, ["tcptunnel.ingress"])
  }

  async revokeDataChannel(srcName, dstName) {
    await this.revoke(srcName, dstName, ["datachannel"])
    await this.revoke(dstName, srcName, ["datachannel"])
  }

  async revokeTcpTunnel(srcName, dstName) {
    await this.revoke(srcName, dstName, ["tcptunnel.egress"])
    await this.revoke(dstName, srcName, ["tcptunnel.ingress"])
  }

  getActiveTcpTunnels() {
    const t = {}
    for (const [dcmId, dcm] of this.dcSessions) {
      t[dcmId] = []
    }
    for (const [tunnelId, tunnel] of this.tcpTunnels) {
      const dcmId = tunnel.dcm.deviceConnectionId
      t[dcmId].push({
        role: tunnel.handler.role,
        id: tunnelId
      })
    }
    return t
  }

  async shutdown() {
    for (const [tunnelId, tunnel] of this.tcpTunnels) {
      await this.closeTcpTunnel(tunnelId)
    }
    for (const [dcmId, dcms] of this.dcSessions) {
      await dcms.dcm.close()
    }
    await this.relayDisconnect()
  }

  async closeDataChannel(dcmId) {
    const d = this.dcSessions.get(dcmId)
    if (!d) {
      throw new Error(`DataChannel not found ${dcmId}`)
    }
    await d.dcm.close()
  }

  async isCurrentDeviceAdmin() {
    return await this.septClient.isCurrentDeviceAdmin()
  }

  async listDevices(excludeLocal = true) {
    const devices = await this.identityStore.list()
    if (!excludeLocal) {
      return devices
    }
    const i = await this.getLocalIdentity()
    return devices.filter(d => d.name !== i.name)
  }

  async registerMobilePushToken(token) {
    await this.septClient.callRest('register-push-token', {
      method: "POST",
      body: { token }
    })
  }

  async resetDevice() {
    await this.septClient.resetDevice()
  }

  async isAdmin(name) {
    for (const d of await this.identityStore.getByName(name)) {
      if (! await this.septClient.isAdmin(d)) {
        return false
      }
    }
    return true
  }

  async getAdmins() {
    const admins = new Set()
    for (const a of await this.septClient.getAdmins()) {
      admins.add(await this.identityStore.getByDevice(a.deviceId))
    }
    return [...admins]
  }
}
