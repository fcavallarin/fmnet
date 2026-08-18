


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
  now
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

    this.systemActions = [
      "sept.policy.update",
      "sept.admin.grant",
      "sept.admin.revoke",

    ]
    this.uiEvents = new EventBus([
      ...this.systemActions,
      "connection.open",
      "connection.close",
      "connection.error",
      "connection.message",
      "export.device",
    ])

    this.actions = {}
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

  on(eventName, handler) {
    let evName = eventName
    if (this.systemActions.includes(`sept.${eventName}`)) {
      evName = `sept.${eventName}`
    }
    if (!this.uiEvents.getEventNames().includes(evName)) {
      throw new Error(`Event not found: ${eventName}`)
    }
    this.uiEvents.on(evName, handler)
  }

  startPolling(time) {
    this.pollingTO = setInterval(async () => {
      await this.sync()
    }, time * 1000)
  }

  stopPolling() {
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

  async bootstrap() {
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
    const deviceId = await this.store.device.add(
      networkId,
      signKeys.publicKey,
      cryptKeys.publicKey,
      'admin'
    )
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

  isAdminRole(role) {
    return role === "admin"
  }

  async getDeviceData() {
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
      isAdmin: this.isAdminRole(device.role)
    }
  }

  async sendEvent(type, message, dstDeviceIds) {  // @TODO: rename message to payload !!!
    const eventStore = this.store.event
    const deviceStore = this.store.device
    const deviceData = await this.getDeviceData();
    const deviceId = deviceData.deviceId
    const senderDeviceId = deviceData.deviceId
    const networkId = deviceData.networkId;

    const payload = {
      type,
      message
    }
    const payloadKey = randomBytes(32);
    const encryptedPayload = serializeBin(encryptWithPayloadKey(payloadKey, canonicalJson(payload)))
    const rcptDevices = await deviceStore.getMulti(dstDeviceIds)

    const recipients = []
    for (const rcptDevice of rcptDevices) {
      if (rcptDevice.cryptPublicKey) {
        // console.log(deviceId, rcptDevice.id, payload.type)
        const policyOk = await this.checkPolicy(deviceId, rcptDevice.id, payload.type)
        if (!policyOk) {
          throw new Error(`Device ${deviceId} not allowed to perform action '${payload.type}'`)
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

    const eventId = await this.addEvent(networkId, null, type, senderDeviceId, recipients, payload, payloadKey, null, now())
    const event = await eventStore.get(eventId);
    const relaySignature = await signString(
      deviceData.signPrivateKey,
      serializeEvent(networkId, recipients, senderDeviceId, encryptedPayload, event.timestamp)
    );
    const signature = await signString(
      deviceData.signPrivateKey,
      serializeEvent(networkId, [], senderDeviceId, encryptedPayload, event.timestamp)
    );
    const postBody = {
      eventId,
      type,
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

  async addDevice(deviceData, metadata, onPaired, onPairingTimeout, pairingTimeout = 60,) {

    const networkStore = this.store.network
    const networkId = (await networkStore.get()).id;
    const localDevice = await this.getDeviceData()
    const pin = randomDigits(4)

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
              // @TODO this should be the list of the adminS deviceS
              rootDeviceId: localDevice.deviceId,
              rootDeviceSignPublicKey: serializeBin(localDevice.signPublicKey),
              rootDeviceCryptPublicKey: serializeBin(localDevice.cryptPublicKey),
              metadata: metadata || {}
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
              metadata: metadata || {}
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

          await this.store.device.import({
            id: pairedDevice.deviceId,
            networkId: pairedDevice.networkId,
            signPublicKey: deserializeBin(pairedDevice.signPublicKey),
            cryptPublicKey: deserializeBin(pairedDevice.cryptPublicKey),
          })

          await this._callRest(
            `paired-devices/${deviceData.deviceId}`,
            { method: "DELETE" }
          )

          await onPaired?.(deviceData.deviceId, pairedDevice.metadata)
          return
        }
      }

      await onPairingTimeout?.(deviceData.deviceId)
    }

    pollPairing()

    return pin
  };


  async getPairing(pin) {  // @TODO: rename to something like doPairing or pair
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
      rootDeviceId,
      networkId,
      rootDeviceSignPublicKey,
      rootDeviceCryptPublicKey,
      metadata
    } = pairingData;

    await this.store.network.add(networkId)
    await this.store.device.add(
      networkId,
      deserializeBin(settings.deviceSignPublicKey),
      deserializeBin(settings.deviceCryptPublicKey),
    )
    await this.store.settings.delete("deviceSignPublicKey")
    await this.store.settings.delete("deviceCryptPublicKey")
    await this.store.device.import({
      id: rootDeviceId,
      networkId,
      signPublicKey: deserializeBin(rootDeviceSignPublicKey),
      cryptPublicKey: deserializeBin(rootDeviceCryptPublicKey),
    }, "admin")

    return metadata
  }

  async initDevice() {
    const settingsStore = this.store.settings
    const signKeys = await generateSigningKeyPair();
    const cryptKeys = await generateEncryptionKeypair();
    await settingsStore.set("deviceSignPrivateKey", serializeBin(signKeys.privateKey));
    await settingsStore.set("deviceSignPublicKey", serializeBin(signKeys.publicKey));
    await settingsStore.set("deviceCryptPrivateKey", serializeBin(cryptKeys.privateKey));
    await settingsStore.set("deviceCryptPublicKey", serializeBin(cryptKeys.publicKey));
    const settings = await settingsStore.get()

    const deviceId = makeId("dev", deserializeBin(settings.deviceSignPublicKey));
    await settingsStore.set("deviceId", deviceId);

    const deviceData = {
      deviceId,
      signPublicKey: settings.deviceSignPublicKey,
      cryptPublicKey: settings.deviceCryptPublicKey,
    };
    this.uiEvents.dispatch("export.device", deviceData)
    return deviceData;
  };

  async addEvent(networkId, eventId, payloadType, senderDeviceId, dstDeviceIds, payload, payloadKey, sequence, timestamp) {
    const isOutgoing = Boolean(dstDeviceIds)
    const isIncoming = !isOutgoing

    return await this.store.event.add(
      networkId,
      payloadType,
      dstDeviceIds || [],
      senderDeviceId,
      payload.message,
      payloadKey,
      eventId || null,
      sequence || null,
      this.systemActions.includes(payloadType),
      isOutgoing,
      isIncoming,
      timestamp
    )
  }

  async handleEvents(events) {
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
        serializeEvent(networkId, [], e.senderDeviceId, e.encryptedPayload, e.timestamp)
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

      const payload = JSON.parse(new TextDecoder().decode(decryptedPayload));

      const policyOk = await this.checkPolicy(e.senderDeviceId, deviceId, payload.type)
      if (!policyOk) {
        console.log(`sync(): Device ${e.senderDeviceId} not allowed to perform action '${payload.type}' to ${deviceId}`)
        ackEvents.push(e.eventId)
        continue;
      }

      const existing = await this.store.event.get(e.eventId)
      if (existing) {
        if (existing.isOutgoing) {
          // Evnets sent to mysqlf have isOutgoing = true and isIncoming=true
          await this.store.event.update(e.eventId, { isIncoming: true })
        } else {
          // The error here may be caused by en event already received bu not acked
          throw new Error("Unexpected error 234")
          // await this.ackEvents([e.eventId])
          // continue

        }
      } else {
        await this.addEvent(
          networkId,
          eventId,
          payload.type,
          e.senderDeviceId,
          null,
          payload,
          payloadKey,
          e.sequence,
          e.timestamp
        )
      }


      if (this.systemActions.includes(payload.type)) {
        if (await this.isAdmin(e.senderDeviceId)) {
          try {
            await eventRouter.route(payload.type, payload.message)
          } catch (e) {
            // Do not ack current event, protocol events cannot be skipped
            // (next sync should fail again if the "root cause" is not fixed)
            await this.ackEvents([...ackEvents])
            throw e
          }
        } else {
          // ignore silently
        }
      }

      if (payload.type in this.actions) {
        const p = [
          payload.message,
          e.senderDeviceId,
          e.timestamp,
          eventId,
          e.sequence
        ]

        try {
          const r = this.actions[payload.type].handler(...p)
          if (this.actions[payload.type].serial) {
            await r
          } else {
            Promise.resolve(r).catch(e => {
              this.ackEvents([...ackEvents, eventId]).then(() => {
                throw e
              })
            })
          }
        } catch (e) {
          await this.ackEvents([...ackEvents, eventId])
          throw e
        }
      }
      ackEvents.push(eventId)

    }

    await this.ackEvents(ackEvents)

  }

  async ackEvents(eventIds) {
    if (eventIds.length > 0) {
      for (const e of eventIds) {
        if (!e) {
          console.log(e)
          throw new Error("ggg")
        }
      }
      await this._callRest("events", {
        method: "PATCH",
        body: { pendingEvents: eventIds }
      });
    }
  }

  async getEvents() {
    const call = await this._callRest("events", {
      method: "GET"
    });
    await this.handleEvents(call.json.events)
  };

  async relayConnect() { // @TODO make it a promise that resolves on connect
    const settings = await this.store.settings.get()
    const networkId = await this.getNetworkId()
    const purl = new URL(this.restEndpoint);
    purl.protocol = purl.protocol === "https" ? "wss" : "ws"
    const wsEndpoint = purl.toString();
    this.wsStatus = "tickedRequested"
    const ticketRes = await this._callRest("get-relay-ticket")
    this.wsStatus = "connecting"
    const queue = new AsyncQueue((i) => this.handleEvents([i]))
    this.ws = new WebSocket(
      `${wsEndpoint}ws?` +
      `networkId=${networkId}&` +
      `deviceId=${settings.deviceId}&` +
      `ticket=${ticketRes.json.ticket}`
    );
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => {
        this.uiEvents.dispatch("connection.open", {})
        console.log("connected to websocket");
        this.wsStatus = "connected"
        this.sync().then(resolve)
      });

      this.ws.addEventListener("message", (event) => {
        this.uiEvents.dispatch("connection.message", event)
        // console.log("WEBSOCKET IN", JSON.parse(event.data))
        queue.push(JSON.parse(event.data))
      });

      this.ws.addEventListener("close", () => {
        this.uiEvents.dispatch("connection.close", {})
        console.log("closed");
        if (this.wsStatus == "connected") {
          this.wsStatus = "reconnecting"
          this.sync().then(() => this.relayConnect())
        } else {
          this.wsStatus = "closed"
        }
      });

      this.ws.addEventListener("error", (err) => {
        this.uiEvents.dispatch("connection.error", {})
        console.error(err);
        if (this.wsStatus == "connected") {
          this.wsStatus = "reconnectingOnError"
          this.sync().then(() => this.relayConnect())
        } else {
          this.wsStatus = "error"
        }
        reject(err)
      });
    })
  }

  async relayDisconnect() {
    if (this.ws && this.wsStatus !== "closing") {
      this.wsStatus = "closing"
      await this.ws.close();
    }
  }

  getWebsocketStatus() {
    return this.wsStatus
  }

  async getNetworkId() {
    const network = await this.store.network.get();
    if (!network) {
      return null;
    }
    return network.id;
  }

  async updatePolicy(srcDeviceId, dstDeviceId, allowedActions, metadata) {
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
      allowedActions
    }
    await this.store.deviceGraphEdge.setPolicy(srcDeviceId, dstDeviceId, policy)
    const evtPayload = {
      networkId,
      dstDevice: {
        deviceId: dstDevice.id,
        signPublicKey: serializeBin(dstDevice.signPublicKey),
        cryptPublicKey: serializeBin(dstDevice.cryptPublicKey)
      },
      srcDevice: {
        deviceId: srcDevice.id,
        signPublicKey: serializeBin(srcDevice.signPublicKey),
        cryptPublicKey: serializeBin(srcDevice.cryptPublicKey)
      },
      policy,
      metadata: metadata || {}
    }
    // @TODO include admin devices on dst
    await this.sendEvent("sept.policy.update", evtPayload, [srcDeviceId, dstDeviceId])
  }

  async getDeviceId() {
    const settings = await this.store.settings.get()
    return settings.deviceId || null;
  }

  async getDeviceGraph() {
    return await this.store.deviceGraphEdge.getGraph();
  }


  register(action, handler, serial = true) {
    if (this.systemActions.includes(action)) {
      throw new Error(`Cannot register action '${action}'`)
    }
    this.actions[action] = { handler, serial }
  }

  registerConcurrent(action, handler) {
    this.register(action, handler, false)
  }

  async getPolicy(srcDeviceId, dstDeviceId) {
    const edge = await this.store.deviceGraphEdge.get(srcDeviceId, dstDeviceId);
    return edge?.policy
  }

  async isAdmin(deviceId) {
    const device = await this.store.device.get(deviceId);
    return device && this.isAdminRole(device.role);
  }

  async isCurrentDeviceAdmin() {
    const deviceData = await this.getDeviceData();
    return deviceData.isAdmin;
  }

  async checkPolicy(srcDeviceId, dstDeviceId, action) {
    if (await this.isAdmin(srcDeviceId)) {
      return true;
    }
    const policy = await this.getPolicy(srcDeviceId, dstDeviceId);
    if (!policy?.allowedActions) {
      return false;
    }
    return policy.allowedActions.includes(action)
  }

  async sync() {
    return await this.getEvents();
  }

  async getStoredActions(filters = {}) {
    return await this.store.event.filter(filters);
  }

  async grant(srcDeviceId, dstDeviceId, actions, metadata) {
    const policy = await this.getPolicy(srcDeviceId, dstDeviceId);
    const allowedActions = [...(policy?.allowedActions || [])]
    for (const action of actions) {
      if (!allowedActions.includes(action)) {
        allowedActions.push(action);
      }
    }
    await this.updatePolicy(srcDeviceId, dstDeviceId, allowedActions, metadata);
  }

  async revoke(srcDeviceId, dstDeviceId, actions, metadata) {
    const policy = await this.getPolicy(srcDeviceId, dstDeviceId);
    const allowedActions = [...(policy?.allowedActions || [])]
    for (const action of actions) {
      if (allowedActions.includes(action)) {
        allowedActions.splice(
          allowedActions.indexOf(action),
          1
        );
      }
    }
    await this.updatePolicy(srcDeviceId, dstDeviceId, allowedActions, metadata);
  }

  async grantAdmin(deviceId) {
    if (!await this.isCurrentDeviceAdmin()) {
      throw new Error("Device must be admin")
    }
    const curDeviceId = await this.getDeviceId()
    const networkId = await this.getNetworkId()
    const recipients = await this.store.device.getAll()
    await this.store.device.update(networkId, deviceId, { role: "admin" })
    await this.sendEvent(
      "sept.admin.grant",
      { networkId, deviceId },
      recipients.map(r => r.id).filter(id => id !== curDeviceId)
    )
    await this._callRest("devices/set-admin", {
      method: "PATCH",
      body: { isAdmin: true, deviceId }
    });
  }

  async revokeAdmin(deviceId) {
    if (!await this.isCurrentDeviceAdmin()) {
      throw new Error("Device must be admin")
    }
    const curDeviceId = await this.getDeviceId()
    const networkId = await this.getNetworkId()
    const recipients = await this.store.device.getAll()
    await this.store.device.update(networkId, deviceId, { role: "user" })
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

  async deleteEvents(filters) {
    const events = await this.store.event.filter({
      ...filters,
      isSystem: false
    })
    // @TODO
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
}