import { logger } from './logger.js';
import { BaseStore } from './base-store.js';


export class IdentityStore extends BaseStore{
  constructor(initKVStore, familyId) {
    super(initKVStore, familyId, "identity")
  }

  async getByName(name) {
    this.assertFamily();
    const i = await this.kvStore.get(
      this.normalizeName(name)
    )
    if (!i) {
      throw new Error(`Device identity '${name}' not found`)
    }
    return i
  }

  async getByDevice(deviceId) {
    this.assertFamily();
    for (const kv of await this.kvStore.all()) {
      if (kv.value.devices.includes(deviceId)) {
        return {
          ...kv.value,
          name: kv.key,
        }
      }
    }
    return null
  }

  async set(deviceId, name, type) {
    this.assertFamily();
    const nname = this.normalizeName(name)
    const i = await this.kvStore.get(
      this.normalizeName(name)
    )
    if (i) {
      const { devices } = i
      if (!devices.includes(deviceId)) {
        devices.push(deviceId)
        await this.kvStore.set(nname, { ...i, devices })
      }
    } else {
      await this.kvStore.set(nname, {type,  devices: [deviceId] })
    }
  }
  async list() {
    this.assertFamily();
    const identities = await this.kvStore.all()
    return identities.map(i => ({
      name: i.key,
      ...i.value,
    }))
  }

  async deleteDevice(deviceId) {
    this.assertFamily();
    for (const kv of await this.kvStore.all()) {
      const idx = kv.value.devices.indexOf(deviceId)
      if (idx > -1) {
        kv.value.devices.splice(idx, 1)
        if (kv.value.devices.length > 0) {
          await this.kvStore.set(kv.key, kv.value)
        } else {
          await this.kvStore.delete(kv.key)
        }
        return
      }
    }
    throw new Error(`Device ${deviceId} not found`)
  }
}