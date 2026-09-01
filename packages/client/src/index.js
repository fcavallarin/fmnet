import { RestClient } from './rest.js';

import {
  generateSigningKeyPair,
  generateEncryptionKeypair,
  signString,
  randomBytes,
  randomDigits,
  encryptWithPayloadKey,
  decryptWithPayloadKey,
  encryptPayloadKey,
  decryptPayloadKey,
  encryptAsymmetric,
  decryptAsymmetric,
  verifyString
} from '@sept/crypto';


import {
  BetterSqliteAdapter,
  ExpoSqliteAdapter,
  canonicalJson,
  deserializeBin,
  makeId,
  serializeBin,
  serializeEvent,
  EventBus,
  AsyncQueue,
  now,
  makeIdFromStr
} from '@sept/core';

import {
  SettingsStore,
  NetworkStore,
  DeviceStore,
  EventStore,
  initDb,
  DeviceGraphEdgeStore,
  RecipientStore,
  AppKVStore,
  resetDb,
} from './stores/index.js'

import { EventRouter } from './event-router.js';




export class SeptClient {

  constructor(options) {
    switch (options.dataStore.type) {
      case "better-sqlite":
        this.dbAdapter = new BetterSqliteAdapter(options.dataStore.open, options.dataStore.close)
        break;
      case "expo-sqlite":
        this.dbAdapter = new ExpoSqliteAdapter(options.dataStore.open, options.dataStore.close)
        break;
    }

    this.store = {}
    this.restClient = null;
    this.restEndpoint = options.restEndpoint || "http://localhost:8787"

    this.pollingTO = null

    this.systemEventTypes = [
      "sept.policy.update",
      "sept.admin.grant",
      "sept.admin.revoke",
      "sept.device.add",  // Device added to the network, only admins will get this event
      "sept.device.invalidate",
    ]

    this.uiEvents = new EventBus([
      ...this.systemEventTypes,
      "connection.open",
      "connection.close",
      "connection.error",
      "connection.message",
      // "export.device",
    ])

    this.registeredEvents = {}
    this.ws = null
    this.wsStatus = "disconnected"
  }

  static async create(options) {
    const cl = new this(options);
    await initDb(cl.dbAdapter, options.dataStore.clearDb === true);
    cl.store = {
      settings: await SettingsStore.create(cl.dbAdapter, options?.secretKeyProvider),
      network: await NetworkStore.create(cl.dbAdapter),
      event: await EventStore.create(cl.dbAdapter),
      device: await DeviceStore.create(cl.dbAdapter),
      deviceGraphEdge: await DeviceGraphEdgeStore.create(cl.dbAdapter),
      appKVStore: await AppKVStore.create(cl.dbAdapter)
    }
    cl.store.event.addRelated("device", cl.store.device)
    cl.store.event.addRelated(
      "recipient",
      await RecipientStore.create(cl.dbAdapter)
    )

    return cl;
  }

  on = (eventName, handler) => {
    let evName = eventName
    if (this.systemEventTypes.includes(`sept.${eventName}`)) {
      evName = `sept.${eventName}`
    }
    if (!this.uiEvents.getEventNames().includes(evName)) {
      throw new Error(`Event not found: ${eventName}`)
    }
    this.uiEvents.on(evName, handler)
  }

  startPolling = (time) => {
    this.pollingTO = setInterval(async () => {
      await this.sync()
    }, time * 1000)
  }

  stopPolling = () => {
    if (this.pollingTO) {
      clearInterval(this.pollingTO)
      this.pollingTO = null
    }
  }

  async _callRest(path, options) {
    if (!this.restClient) {
      const s = await this.store.settings.get();
      this.restClient = new RestClient(s.deviceId, s.deviceSignPrivateKey, this.restEndpoint)
    }

    return await this.restClient.call(path, options);
  }

  callRest = async (path, options) => { // Public API to call custom server endpoints
    return await this._callRest(path, options)
  }

  bootstrap = async () => {
    const networkStore = this.store.network;
    const networkId = await networkStore.create();
    let settings = await this.store.settings.get()
    if (settings.deviceSignPrivateKey) {
      throw new Error("cannot bootstrap")
    }
    const signKeys = await generateSigningKeyPair();
    const cryptKeys = await generateEncryptionKeypair();
    await this.store.settings.set("deviceSignPrivateKey", serializeBin(signKeys.privateKey), true);
    await this.store.settings.set("deviceCryptPrivateKey", serializeBin(cryptKeys.privateKey), true);
    const deviceId = await this.store.device.create({
      networkId,
      signPublicKey: signKeys.publicKey,
      cryptPublicKey: cryptKeys.publicKey,
      role: 'admin'
    })
    await this.store.settings.set("deviceId", deviceId);
    settings = await this.store.settings.get()

    const body = {
      networkId,
      rootDeviceId: settings.deviceId,
      rootDeviceSignPublicKey: serializeBin(signKeys.publicKey),
    }

    const call = await this._callRest("bootstrap", {
      method: "POST",
      body
    });

    if (call.json.ok) {
      return networkId;
    } else {
      throw new Error("server error")
    }
  };

  _isAdminRole(role) {
    return role === "admin"
  }

  async _getDeviceData() {
    const settings = await this.store.settings.get()
    const device = await this.store.device.get(settings.deviceId);
    return {
      networkId: await this.getNetworkId(),
      deviceId: settings.deviceId,
      signPublicKey: device.signPublicKey,
      signPrivateKey: deserializeBin(settings.deviceSignPrivateKey),
      cryptPublicKey: device.cryptPublicKey,
      cryptPrivateKey: deserializeBin(settings.deviceCryptPrivateKey),
      role: device.role,
      isAdmin: this._isAdminRole(device.role)
    }
  }

  sendEvent = async (type, payload, dstDeviceIds) => {
    const eventStore = this.store.event
    const deviceStore = this.store.device
    const deviceData = await this._getDeviceData();
    const deviceId = deviceData.deviceId
    const senderDeviceId = deviceData.deviceId
    const networkId = deviceData.networkId;

    const evPayload = {
      type,
      payload
    }
    const payloadKey = randomBytes(32);
    const encryptedPayload = serializeBin(
      encryptWithPayloadKey(payloadKey, canonicalJson(evPayload))
    )
    const rcptDevices = await deviceStore.getMulti(dstDeviceIds || [])

    const recipients = []
    for (const rcptDevice of rcptDevices) {
      if (rcptDevice.cryptPublicKey) {
        const policyOk = await this.checkPolicy(deviceId, rcptDevice.id, evPayload.type)
        if (!policyOk) {
          throw new Error(`Device ${deviceId} not allowed to perform '${evPayload.type}'`)
        }
        recipients.push(
          {
            deviceId: rcptDevice.id,
            encryptedPayloadKey: serializeBin(
              encryptPayloadKey(
                deviceData.cryptPrivateKey,
                rcptDevice.cryptPublicKey,
                payloadKey
              )
            )
          }
        )
      }
    }

    if (recipients.length === 0) {
      throw new Error("Empty recipient list")
    }
    const ts = now()
    const eventId = makeIdFromStr("evt", serializeEvent(networkId, "", recipients, senderDeviceId, encryptedPayload, ts))
    await this._addEvent(networkId, eventId, type, senderDeviceId, recipients, evPayload.payload, payloadKey, null, ts)
    const event = await eventStore.get(eventId);
    const relaySignature = await signString(
      deviceData.signPrivateKey,
      serializeEvent(networkId, eventId, recipients, senderDeviceId, encryptedPayload, event.timestamp)
    );
    const signature = await signString(
      deviceData.signPrivateKey,
      serializeEvent(networkId, eventId, [], senderDeviceId, encryptedPayload, event.timestamp)
    );
    const postBody = {
      eventId,
      senderDeviceId,
      encryptedPayload,
      recipients,
      timestamp: event.timestamp,
      signature: serializeBin(signature),
      relaySignature: serializeBin(relaySignature)
    }
    const call = await this._callRest("event", {
      method: "POST",
      body: postBody
    });

    const sequence = call.json.sequence;
    await this.store.event.setSequence(eventId, sequence)
  };

  addDevice = async (deviceData, metadata, onPaired, onPairingTimeout, pairingTimeout = 60) => {

    const networkStore = this.store.network
    const networkId = (await networkStore.get()).id;
    const localDevice = await this._getDeviceData()
    const pin = randomDigits(4)
    const admins = await this.store.device.getAdmins()
    await this._callRest("devices/create-pairing", {
      method: "POST",
      body: {
        id: deviceData.deviceId,
        pin,
        networkId,
        signPublicKey: deviceData.signPublicKey,
        senderPublicCryptKey: serializeBin(localDevice.cryptPublicKey),
        encryptedPayload: serializeBin(
          encryptAsymmetric(
            localDevice.cryptPrivateKey,
            deserializeBin(deviceData.cryptPublicKey),
            new TextEncoder().encode(canonicalJson({
              networkId,
              rootDevices: admins.map(d => ({
                deviceId: d.id,
                signPublicKey: serializeBin(d.signPublicKey),
                cryptPublicKey: serializeBin(d.cryptPublicKey),
              })),
              metadata: metadata?.deviceMetadata || {}
            })
            ))
        ),
        encryptedAdminPayload: serializeBin(
          encryptAsymmetric(
            localDevice.cryptPrivateKey,
            localDevice.cryptPublicKey,
            new TextEncoder().encode(canonicalJson({
              deviceId: deviceData.deviceId,
              networkId,
              signPublicKey: deviceData.signPublicKey,
              cryptPublicKey: deviceData.cryptPublicKey,
              metadata: metadata?.adminMetadata || {}
            })
            ))
        )
      }
    });

    const pollPairing = async () => {
      for (let pairingTime = 0; pairingTime < pairingTimeout; pairingTime++) {
        await new Promise(resolve => setTimeout(resolve, 1000))

        const r = await this._callRest("paired-devices")

        for (const d of r.json.devices) {
          const pairedDevice = JSON.parse(
            new TextDecoder().decode(
              decryptAsymmetric(
                localDevice.cryptPrivateKey,
                localDevice.cryptPublicKey,
                deserializeBin(d.encryptedPayload),
              )
            )
          )

          if (pairedDevice.deviceId !== deviceData.deviceId) {
            continue
          }

          await this.store.device.upsert(pairedDevice.deviceId, {
            networkId: pairedDevice.networkId,
            signPublicKey: deserializeBin(pairedDevice.signPublicKey),
            cryptPublicKey: deserializeBin(pairedDevice.cryptPublicKey),
          })

          await this._callRest(
            `paired-devices/${deviceData.deviceId}`,
            { method: "DELETE" }
          )
          const admins = await this.store.device.getAdmins()
          const recipients = admins.filter(d => d.id !== localDevice.deviceId).map(d => d.id)
          if (recipients.length > 0) {
            await this.sendEvent(
              "sept.device.add",
              {
                id: pairedDevice.deviceId,
                networkId: pairedDevice.networkId,
                signPublicKey: pairedDevice.signPublicKey,
                cryptPublicKey: pairedDevice.cryptPublicKey,
                metadata: pairedDevice.metadata
              },
              recipients
            )
          }

          await onPaired?.(pairedDevice.deviceId, pairedDevice.metadata)
          return
        }
      }

      await onPairingTimeout?.(deviceData.deviceId)
    }

    void pollPairing()

    return pin
  };


  pairDevice = async (pin) => {
    const settings = await this.store.settings.get()
    let call = await this._callRest(`devices/pairing/${settings.deviceId}/${pin}`)

    const pairingData = JSON.parse(new TextDecoder().decode(decryptAsymmetric(
      deserializeBin(settings.deviceCryptPrivateKey),
      deserializeBin(call.json.pairingData.senderCryptPublicKey),
      deserializeBin(call.json.pairingData.encryptedPayload),
    )))

    // Pairing trust bootstrap:
    // At this stage the device has no trusted admin key yet.
    // The relay is the source of truth for whether this pairing was created by an admin.
    // After accepting the pairing, rootDeviceSignPublicKey becomes the local trust anchor.
    const {
      networkId,
      rootDevices,
      metadata
    } = pairingData;

    await this.store.network.add(networkId)
    await this.store.device.create({
      networkId,
      signPublicKey: deserializeBin(settings.deviceSignPublicKey),
      cryptPublicKey: deserializeBin(settings.deviceCryptPublicKey),
    })
    await this.store.settings.delete("deviceSignPublicKey")
    await this.store.settings.delete("deviceCryptPublicKey")
    for (const adm of rootDevices) {
      await this.store.device.add({
        id: adm.deviceId,
        networkId,
        signPublicKey: deserializeBin(adm.signPublicKey),
        cryptPublicKey: deserializeBin(adm.cryptPublicKey),
        role: "admin"
      })
    }

    return metadata
  }

  initDevice = async () => {
    const settingsStore = this.store.settings
    const signKeys = await generateSigningKeyPair();
    const cryptKeys = await generateEncryptionKeypair();
    await settingsStore.set("deviceSignPrivateKey", serializeBin(signKeys.privateKey));
    await settingsStore.set("deviceSignPublicKey", serializeBin(signKeys.publicKey));
    await settingsStore.set("deviceCryptPrivateKey", serializeBin(cryptKeys.privateKey), true);
    await settingsStore.set("deviceCryptPublicKey", serializeBin(cryptKeys.publicKey), true);
    const settings = await settingsStore.get()

    const deviceId = makeId("dev", deserializeBin(settings.deviceSignPublicKey));
    await settingsStore.set("deviceId", deviceId);

    const deviceData = {
      deviceId,
      signPublicKey: settings.deviceSignPublicKey,
      cryptPublicKey: settings.deviceCryptPublicKey,
    };

    return deviceData;
  };

  async _addEvent(networkId, eventId, payloadType, senderDeviceId, dstDeviceIds, payload, payloadKey, sequence, timestamp) {
    const isOutgoing = Boolean(dstDeviceIds)
    const isIncoming = !isOutgoing

    return await this.store.event.add(
      networkId,
      payloadType,
      dstDeviceIds || [],
      senderDeviceId,
      payload,
      payloadKey,
      eventId,
      sequence || null,
      this.systemEventTypes.includes(payloadType),
      isOutgoing,
      isIncoming,
      timestamp
    )
  }

  async _handleEvents(events) {
    const settings = await this.store.settings.get()
    const eventRouter = new EventRouter(this.uiEvents, this.store)
    const networkId = await this.getNetworkId()
    const deviceId = await this.getDeviceId()
    const ackEvents = [];
    for (const e of events) {
      const { eventId } = e
      const senderDevice = await this.store.device.get(e.senderDeviceId)
      if (!senderDevice) {
        throw new Error("unauthorized2 " + e.senderDeviceId);
      }

      const verified = await verifyString(
        senderDevice.signPublicKey,
        deserializeBin(e.signature),
        serializeEvent(networkId, eventId, [], e.senderDeviceId, e.encryptedPayload, e.timestamp)
      )
      if (!verified) {
        throw new Error("Signature verification failed");
      }
      const payloadKey = decryptPayloadKey(
        deserializeBin(settings.deviceCryptPrivateKey),
        senderDevice.cryptPublicKey,
        deserializeBin(e.encryptedPayloadKey)
      )
      const decryptedPayload = decryptWithPayloadKey(
        payloadKey,
        deserializeBin(e.encryptedPayload)
      )

      const evPayload = JSON.parse(new TextDecoder().decode(decryptedPayload));

      const policyOk = await this.checkPolicy(e.senderDeviceId, deviceId, evPayload.type)
      if (!policyOk) {
        console.log(`sync(): Device ${e.senderDeviceId} not allowed to perform '${evPayload.type}' to ${deviceId}`)
        ackEvents.push(e.eventId)
        continue;
      }

      const existing = await this.store.event.get(e.eventId)
      if (existing) {
        if (existing.isOutgoing) {
          // Evnets sent to myself have isOutgoing = true and isIncoming=true
          await this.store.event.update(e.eventId, { isIncoming: true })
        } else {
          // The error here may be caused by en event already received but not acked
          throw new Error("Unexpected error 234")
          // await this._ackEvents([e.eventId])
          continue

        }
      } else {
        await this._addEvent(
          networkId,
          eventId,
          evPayload.type,
          e.senderDeviceId,
          null,
          evPayload.payload,
          payloadKey,
          e.sequence,
          e.timestamp
        )
      }


      if (this.systemEventTypes.includes(evPayload.type)) {
        if (await this.isAdmin(e.senderDeviceId)) {
          try {
            await eventRouter.route(evPayload.type, evPayload.payload)
          } catch (e) {
            // Do not ack current event, protocol events cannot be skipped
            // (next sync should fail again if the "root cause" is not fixed)
            await this._ackEvents([...ackEvents])
            throw e
          }
        } else {
          // ignore silently
        }
      }

      if (evPayload.type in this.registeredEvents) {
        const p = [
          evPayload.payload,
          e.senderDeviceId,
          e.timestamp,
          eventId,
          e.sequence
        ]

        try {
          const r = this.registeredEvents[evPayload.type].handler(...p)
          if (this.registeredEvents[evPayload.type].serial) {
            await r
          } else {
            Promise.resolve(r).catch(e => {
              this._ackEvents([...ackEvents, eventId]).then(() => {
                throw e
              })
            })
          }
        } catch (e) {
          await this._ackEvents([...ackEvents, eventId])
          throw e
        }
      }
      ackEvents.push(eventId)

    }

    await this._ackEvents(ackEvents)

  }

  async _ackEvents(eventIds) {
    if (eventIds.length > 0) {
      for (const e of eventIds) {
        if (!e) {
          throw new Error(`Unable to ACK event ${e}`)
        }
      }
      await this._callRest("events", {
        method: "PATCH",
        body: { pendingEvents: eventIds }
      });
    }
  }

  async _getEvents() {
    const call = await this._callRest("events", {
      method: "GET"
    });
    await this._handleEvents(call.json.events)
  };

  connect = async () => {
    if (this.wsStatus === "connected") {
      return
    }

    const settings = await this.store.settings.get()
    const networkId = await this.getNetworkId()
    const purl = new URL(this.restEndpoint);
    purl.protocol = purl.protocol === "https" ? "wss" : "ws"
    const wsEndpoint = purl.toString();
    this.wsStatus = "tickedRequested"
    const ticketRes = await this._callRest("get-relay-ticket")
    this.wsStatus = "connecting"
    const queue = new AsyncQueue((i) => this._handleEvents([i]))
    this.ws = new WebSocket(
      `${wsEndpoint}ws?` +
      `networkId=${networkId}&` +
      `deviceId=${settings.deviceId}&` +
      `ticket=${ticketRes.json.ticket}`
    );
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => {
        this.uiEvents.dispatch("connection.open", {})
        this.wsStatus = "connected"
        this.sync().then(resolve)
      });

      this.ws.addEventListener("message", (event) => {
        this.uiEvents.dispatch("connection.message", event)
        queue.push(JSON.parse(event.data))
      });

      this.ws.addEventListener("close", () => {
        this.uiEvents.dispatch("connection.close", {})
        if (this.wsStatus == "connected") {
          this.wsStatus = "reconnecting"
          this.sync().then(() => this.connect())
        } else {
          this.wsStatus = "closed"
        }
      });

      this.ws.addEventListener("error", (err) => {
        this.uiEvents.dispatch("connection.error", {})
        if (this.wsStatus == "connected") {
          this.wsStatus = "reconnectingOnError"
          this.sync().then(() => this.connect())
        } else {
          this.wsStatus = "error"
        }
        reject(err)
      });
    })
  }

  disconnect = async () => {
    if (this.ws && this.wsStatus !== "closing") {
      this.wsStatus = "closing"
      await this.ws.close();
    }
  }

  getWebsocketStatus = () => {
    return this.wsStatus
  }

  getNetworkId = async () => {
    const network = await this.store.network.get();
    if (!network) {
      return null;
    }
    return network.id;
  }

  async _updatePolicy(srcDeviceId, dstDeviceId, allowedEventTypes, metadata) {
    if (!await this.isCurrentDeviceAdmin()) {
      throw new Error("Device must be admin")
    }
    const deviceStore = this.store.device
    let networkId = null;
    const dstDevice = await deviceStore.get(dstDeviceId);
    if (!networkId) {
      networkId = dstDevice.networkId;
    } else {
      if (networkId !== dstDevice.networkId) {
        throw new Error("Source devices must belong to the same network")
      }
    }

    if (!networkId) {
      throw new Error("Source devices list is empty")
    }
    const srcDevice = await deviceStore.get(srcDeviceId);

    if (networkId !== srcDevice.networkId) {
      throw new Error("Source devices and destination devices must belong to the same network")
    }

    const policy = {
      allowedEventTypes
    }
    await this.store.deviceGraphEdge.setPolicy(srcDeviceId, dstDeviceId, policy)
    const evtPayload = {
      networkId,  // @TODO [security]: should the client validate networkId? is it possible that admin of networkX updates the policy of networkY?
      devices: [
        {
          id: dstDevice.id,
          signPublicKey: serializeBin(dstDevice.signPublicKey),
          cryptPublicKey: serializeBin(dstDevice.cryptPublicKey)
        },
        {
          id: srcDevice.id,
          signPublicKey: serializeBin(srcDevice.signPublicKey),
          cryptPublicKey: serializeBin(srcDevice.cryptPublicKey)
        }
      ],
      policies: [{
        dstDeviceId: dstDevice.id,
        srcDeviceId: srcDevice.id,
        policy,
      }],
      metadata: metadata || {}
    }

    const admins = await this.store.device.getAdmins()
    const deviceId = await this.getDeviceId()
    const admRecipients = admins.filter(d => d.id !== deviceId).map(d => d.id)
    await this.sendEvent(
      "sept.policy.update",
      evtPayload,
      [srcDeviceId, dstDeviceId, ...admRecipients]
    )
  }

  getDeviceId = async () => {
    const settings = await this.store.settings.get()
    return settings.deviceId || null;
  }

  getDeviceGraph = async () => {
    return await this.store.deviceGraphEdge.getGraph();
  }


  register = (eventType, handler, serial = true) => {
    if (this.systemEventTypes.includes(eventType)) {
      throw new Error(`Cannot register eventType '${eventType}'`)
    }
    this.registeredEvents[eventType] = { handler, serial }
  }

  registerConcurrent = (eventType, handler) => {
    this.register(eventType, handler, false)
  }

  getPolicy = async (srcDeviceId, dstDeviceId) => {
    const edge = await this.store.deviceGraphEdge.get(srcDeviceId, dstDeviceId);
    return edge?.policy
  }

  isAdmin = async (deviceId) => {
    const device = await this.store.device.get(deviceId);
    return device && this._isAdminRole(device.role);
  }

  isCurrentDeviceAdmin = async () => {
    const deviceData = await this._getDeviceData();
    return deviceData.isAdmin;
  }

  checkPolicy = async (srcDeviceId, dstDeviceId, eventType) => {
    if (await this.isAdmin(srcDeviceId)) {
      return true;
    }
    const policy = await this.getPolicy(srcDeviceId, dstDeviceId);
    if (!policy?.allowedEventTypes) {
      return false;
    }
    return policy.allowedEventTypes.includes(eventType)
  }

  sync = async () => {
    return await this._getEvents();
  }

  getStoredEvents = async (filters = {}) => {
    return await this.store.event.filter(filters);
  }

  grant = async (srcDeviceId, dstDeviceId, eventTypes, metadata) => {
    const policy = await this.getPolicy(srcDeviceId, dstDeviceId);
    const allowedEventTypes = [...(policy?.allowedEventTypes || [])]
    for (const eventType of eventTypes) {
      if (!allowedEventTypes.includes(eventType)) {
        allowedEventTypes.push(eventType);
      }
    }
    await this._updatePolicy(srcDeviceId, dstDeviceId, allowedEventTypes, metadata);
  }

  revoke = async (srcDeviceId, dstDeviceId, eventTypes, metadata) => {
    const policy = await this.getPolicy(srcDeviceId, dstDeviceId);
    const allowedEventTypes = [...(policy?.allowedEventTypes || [])]
    for (const eventType of eventTypes) {
      if (allowedEventTypes.includes(eventType)) {
        allowedEventTypes.splice(
          allowedEventTypes.indexOf(eventType),
          1
        );
      }
    }
    await this._updatePolicy(srcDeviceId, dstDeviceId, allowedEventTypes, metadata);
  }

  grantAdmin = async (deviceId, metadata = {}) => {
    if (!await this.isCurrentDeviceAdmin()) {
      throw new Error("Device must be admin")
    }
    const curDeviceId = await this.getDeviceId()
    const networkId = await this.getNetworkId()
    const recipients = await this.store.device.getAll()
    const device = await this.store.device.get(deviceId)
    if (!device) {
      throw new Error(`Device ${deviceId} not found`)
    }

    await this.store.device.upsert(deviceId, { role: "admin" })

    await this.sendEvent(
      "sept.admin.grant",
      {
        networkId,
        deviceId,
        signPublicKey: serializeBin(device.signPublicKey),
        cryptPublicKey: serializeBin(device.cryptPublicKey),
        metadata: metadata.adminMetadata || {}
      },
      recipients.map(r => r.id).filter(id => id !== curDeviceId)
    )

    await this._callRest("devices/set-admin", {
      method: "PATCH",
      body: { isAdmin: true, deviceId }
    });

    const evtPayload = {
      networkId,
      devices: [],
      policies: [],
      metadata: metadata.devicesMetadata || {}
    }

    for (const d of await this.getDevices()) {
      evtPayload.devices.push({
        id: d.id,
        signPublicKey: serializeBin(d.signPublicKey),
        cryptPublicKey: serializeBin(d.cryptPublicKey)
      })
    }

    for (const g of await this.getDeviceGraph()) {
      evtPayload.policies.push({
        dstDeviceId: g.dstDeviceId,
        srcDeviceId: g.srcDeviceId,
        policy: g.policy,
      })
    }

    await this.sendEvent(
      "sept.policy.update",
      evtPayload,
      [deviceId]
    )

  }

  revokeAdmin = async (deviceId) => {
    if (!await this.isCurrentDeviceAdmin()) {
      throw new Error("Device must be admin")
    }
    const curDeviceId = await this.getDeviceId()
    const networkId = await this.getNetworkId()
    const recipients = await this.store.device.getAll()

    await this.store.device.upsert(deviceId, { role: "user" })
    await this.sendEvent(
      "sept.admin.revoke",
      { networkId, deviceId },
      recipients.map(r => r.id).filter(id => id !== curDeviceId)
    )
    await this._callRest("devices/set-admin", {
      method: "PATCH",
      body: { isAdmin: false, deviceId }
    });
  }


  // The Life Tradeoff:
  // SEPT already owns the local runtime storage.
  // This KV store is exposed as an opaque, namespaced convenience layer
  // for applications that need small persistent state without owning
  // another cross-platform storage adapter.
  appStorage = (namespace) => {
    const q = new AsyncQueue(async i => {
      const { key, value, action, resolve, reject } = i

      try {
        switch (action) {
          case "get":
            resolve(await this.store.appKVStore.get(namespace, key))
            break

          case "set": {
            const newValue = typeof value === "function"
              ? await value(
                await this.store.appKVStore.get(namespace, key)
              )
              : value

            await this.store.appKVStore.set(namespace, key, newValue)
            resolve()
            break
          }

          case "delete":
            await this.store.appKVStore.delete(namespace, key)
            resolve()
            break

          case "keys":
            resolve(await this.store.appKVStore.keys(namespace))
            break

          case "all":
            resolve(await this.store.appKVStore.all(namespace))
            break

          default:
            throw new Error(`Unknown appStorage action: ${action}`)
        }
      } catch (err) {
        reject(err)
      }
    })

    const enqueue = (action, key, value) =>
      new Promise((resolve, reject) => {
        q.push({ action, key, value, resolve, reject })
      })

    return {
      get: key => enqueue("get", key),
      set: (key, value) => enqueue("set", key, value),
      delete: key => enqueue("delete", key),
      keys: () => enqueue("keys"),
      all: () => enqueue("all"),
    }
  }

  resetDevice = async () => {
    await resetDb(this.dbAdapter)
  }

  getDevices = async () => {
    return await this.store.device.getAll()
  }

  invalidateDevice = async (deviceId) => {
    if (!await this.isCurrentDeviceAdmin()) {
      throw new Error("Device must be admin")
    }
    const curDeviceId = await this.getDeviceId()
    const admins = await this.store.device.getAdmins()
    const recipients = admins.filter(d => d.id !== curDeviceId).map(d => d.id)
    const graph = await this.getDeviceGraph()
    for (const g of graph) {
      if (g.srcDeviceId === deviceId) {
        recipients.push(g.dstDeviceId)
        continue
      }
      if (g.dstDeviceId === deviceId) {
        recipients.push(g.srcDeviceId)
        continue
      }
    }

    await this.sendEvent(
      "sept.device.invalidate",
      { deviceId },
      [...new Set(recipients)]
    )

    await this._callRest("devices/invalidate", {
      method: "POST",
      body: { deviceId }
    })

    await this.store.device.upsert(deviceId, { revokedAt: now() })
  }

  getAdmins = async () => {
    const admins = await this.store.device.getAdmins()
    return admins.map(d => ({
      deviceId: d.id,
      signPublicKey: d.signPublicKey,
      cryptPublicKey: d.cryptPublicKey,
    }))
  }
}