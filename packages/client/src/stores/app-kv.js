import { BaseStore } from './base.js'
import {
  randomBytes,
  encryptSymmetric,
  decryptSymmetric
} from '@sept/crypto';

import { deserializeBin, makeId, serializeBin, makeIdFromStr, serializeEvent, AsyncQueue, } from '@sept/core';

  
export class AppKVStore extends BaseStore {
  static create(dbAdapter) {
    const i = super.create(dbAdapter, "app_kv_store");
    i.queue = new AsyncQueue()
    return i
  }

  async get(namespace, key) {
    const row = await this.db.readOne(
      `SELECT * from app_kv_store where key = ? and namespace = ?`
      , [key, namespace]
    );
    return row ? JSON.parse(row.value) : null
  }

  async keys(namespace) {
    const rows = await this.db.read(
      `SELECT key from app_kv_store where namespace = ?`
      , [namespace]
    )
    return rows.map(r => r.key);
  }

  async all(namespace) {
    const rows = await this.db.read(
      `SELECT key, value from app_kv_store where namespace = ?`
      , [namespace]
    )
    return rows.map(r => ({ key: r.key, value: JSON.parse(r.value) }));
  }

  async set(namespace, key, value) {
    const qry = `
      INSERT INTO app_kv_store (namespace, key, value)
      VALUES (?, ?, ?)
      ON CONFLICT(namespace, key)
      DO UPDATE SET value = excluded.value
    `
    return await this.db.write(qry, [namespace, key, JSON.stringify(value)])
  }

  async delete(namespace, key) {
    return await this.db.write(
      `DELETE from app_kv_store where key = ? and namespace = ?`, [key, namespace]
    )
  }
}
