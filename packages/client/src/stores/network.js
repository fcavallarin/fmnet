import { BaseStore } from './base.js'
import {
  randomBytes,
  encryptSymmetric,
  decryptSymmetric
} from '@sept/crypto';

import { deserializeBin, makeId, serializeBin, makeIdFromStr, serializeEvent } from '@sept/core';

export class NetworkStore extends BaseStore {
  static create(dbAdapter) {
    return super.create(dbAdapter, "network")
  }
  async get() {
    return this.deserialize(
      await this.db.readOne(`SELECT * from network`)
    );
  }

  async create() {
    const id = makeId("net", randomBytes(32));
    await this.db.write(`INSERT INTO network (id) VALUES (?)`, [id])
    return id
  }

  async add(id) {
    return await this.db.write(`INSERT INTO network (id) VALUES (?)`, [id])
  }
}
