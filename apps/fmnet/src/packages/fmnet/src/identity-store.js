import { logger } from './logger.js';



export class IdentityStore {
  constructor(initKVStore, familyId) {
    this.initKVStore = initKVStore
    this.familyId = familyId;
    this.kvStore = null;
    if (familyId) {
      this.setFamilyId(familyId)
    }
  }

  normalizeName(name) {
    return name.trim()
  }

  setFamilyId(familyId) {
    this.familyId = familyId;
    this.kvStore = this.initKVStore(`fmnet:identity:${familyId}`)
  }
  assertFamily() {
    if (!this.familyId) {
      throw new Error("Family not set")
    }
  }

  async getByName(name) {
    this.assertFamily();
    return await this.kvStore.get(
      this.normalizeName(name)
    )
  }

  async getByDevice(deviceId) {
    this.assertFamily();
    for (const kv of await this.kvStore.all()) {
      if (kv.value.includes(deviceId)) {
        return kv.key
      }
    }
    return null
  }

  async set(deviceId, name) {
    this.assertFamily();
    const nname = this.normalizeName(name)
    const existing = await this.getByName(nname);
    if (existing) {
      if (!existing.includes(deviceId)) {
        existing.push(deviceId)
        await this.kvStore.set(nname, existing)
      }
    } else {
      await this.kvStore.set(nname, [deviceId])
    }
  }
  async list() {
    this.assertFamily();
    const identities = await this.kvStore.all()
    return identities.map(i => ({
      name: i.key,
      devices: i.value
    }))
  }

  async deleteDevice(deviceId) {
    this.assertFamily();
    for (const kv of await this.kvStore.all()) {
      const idx = kv.value.indexOf(deviceId)
      if (idx > -1) {
        kv.value.splice(idx, 1)
        if(kv.value.length > 0){
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