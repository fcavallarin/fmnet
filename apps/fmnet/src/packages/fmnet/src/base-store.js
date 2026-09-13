import { logger } from './logger.js';

export class BaseStore {
  constructor(initKVStore, familyId, namespace) {
    this.initKVStore = initKVStore
    this.familyId = familyId;
    this.namespace = namespace
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
    this.kvStore = this.initKVStore(`fmnet:${this.namespace}:${familyId}`)
  }
  
  assertFamily() {
    if (!this.familyId) {
      throw new Error("Family not set")
    }
  }
}