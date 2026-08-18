import { BaseStore } from './base.js'
import {
  randomBytes,
  encryptSymmetric,
  decryptSymmetric
} from '@sept/crypto';

import { deserializeBin, makeId, serializeBin, makeIdFromStr, serializeEvent } from '@sept/core';



export class SettingsStore extends BaseStore {
  static async create(dbAdapter, getEncryptionKey) {
    const i = await super.create(dbAdapter, "setting");
    if (!getEncryptionKey) {
      throw new Error("Missing getEncryptionKey")
    }
    i.getEncryptionKey = getEncryptionKey
    return i
  }

  async encodeSecret(value) {
    return encryptSymmetric(await this.getEncryptionKey(), value)
  }

  async decodeSecret(nonce, value) {
    return new TextDecoder().decode(
      decryptSymmetric(await this.getEncryptionKey(), deserializeBin(nonce), deserializeBin(value))
    )
  }

  async get() {
    const settings = {};
    const res = await this.db.read(`SELECT * from setting`);
    for (const r of res) {
      settings[r.key] = r.isSecret
        ? await this.decodeSecret(r.nonce, r.value)
        : r.value
    }

    return settings;
  }

  async set(key, value, isSecret = false) {
    let v = value
    let encrNonce = null;
    if (isSecret) {
      const { encrypted, nonce } = await this.encodeSecret(v)
      v = serializeBin(encrypted)
      encrNonce = serializeBin(nonce)
    }

    const qry = `
      INSERT INTO setting (value, is_secret, nonce, key)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key)
      DO UPDATE SET 
      value = excluded.value,
      is_secret = excluded.is_secret,
      nonce = excluded.nonce
    `

    return await this.db.write(qry, [v, isSecret ? 1 : 0, encrNonce, key])
  }

  async delete(key) {
    return await this.db.write(
      `DELETE from setting where key=?`, [key]
    )
  }
}
