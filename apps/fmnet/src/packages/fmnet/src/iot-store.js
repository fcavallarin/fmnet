import { logger } from './logger.js';
import { BaseStore } from './base-store.js';


export class IoTStore extends BaseStore{
  constructor(initKVStore, familyId) {
    super(initKVStore, familyId, "iot")
  }

  async set(deviceId, actions) {
    this.assertFamily();
    await this.kvStore.set(deviceId, actions)
  }

  async get(deviceId) {
    this.assertFamily();
    return await this.kvStore.get(deviceId)
  }
}