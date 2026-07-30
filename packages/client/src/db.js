
import {
  randomBytes,
  encryptSymmetric,
  decryptSymmetric
} from '@sept/crypto';

import { deserializeBin, makeId, serializeBin, makeIdFromStr, serializeEvent } from '@sept/core';



export async function initDb(db, force = false) {

  if (force) {
    try {
      await db.write(`DROP TABLE network`);
      await db.write(`DROP TABLE setting`);
      await db.write(`DROP TABLE device`);
      await db.write(`DROP TABLE event`);
      await db.write(`DROP TABLE event_recipient`);
      await db.write(`DROP TABLE device_graph_edge`);
      await db.write(`DROP TABLE app_kv_store`);

      await db.write(`PRAGMA user_version = 0`);
    } catch { }
  }

  const dbVersion = (await db.readOne('PRAGMA user_version')).userVersion

  if (dbVersion > 0) {
    return
  }

  await db.write(`PRAGMA user_version = 1`);

  await db.write(`
    CREATE TABLE IF NOT EXISTS network (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.write(`
    CREATE TABLE IF NOT EXISTS setting (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0,
      nonce TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(key)
    );
  `);

  await db.write(`
    CREATE TABLE IF NOT EXISTS device (
      id TEXT PRIMARY KEY NOT NULL,
      network_id TEXT NOT NULL,
      sign_public_key TEXT NOT NULL,
      crypt_public_key TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      revoked_at INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (network_id) REFERENCES network(id)
    );
  `);

  await db.write(`
    CREATE TABLE IF NOT EXISTS event (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      sender_device_id TEXT NOT NULL,
      payload_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      delivered_at INTEGER,
      sequence INTEGER UNIQUE,
      is_system INTEGER NOT NULL,
      is_outgoing INTEGER NOT NULL,
      is_incoming INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.write(`
    CREATE TABLE IF NOT EXISTS event_recipient (
      event_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      encrypted_payload_key TEXT,
      PRIMARY KEY(event_id, device_id),
      FOREIGN KEY(event_id) REFERENCES event(id),
      FOREIGN KEY(device_id) REFERENCES device(id)
    );
  `);


  await db.write(`
    CREATE TABLE IF NOT EXISTS device_graph_edge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src_device_id TEXT NOT NULL,
      dst_device_id TEXT NOT NULL,
      policy TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (src_device_id) REFERENCES device(id),
      FOREIGN KEY (dst_device_id) REFERENCES device(id)
    );
  `);

  await db.write(`
    CREATE TABLE IF NOT EXISTS app_kv_store (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(namespace, key)
    );
  `);

}

class BaseStore {
  constructor(dbAdapter, tableName, serializers) {
    this.db = dbAdapter;
    this.tableName = tableName;
    this.relatedStores = {}
    this.tableFields = []
    this.serializers = serializers || {}
  }

  addRelated(name, store) {
    this.relatedStores[name] = store
  }

  static async create(dbAdapter, tableName, serializers) {
    const i = new this(dbAdapter, tableName, serializers)
    const info = await dbAdapter.read(`PRAGMA table_info(${tableName})`)
    i.tableFields = info.map(f => f.name)
    return i
  }

  deserialize(d) {
    if (!d) return null
    const deserialized = { ...d }
    for (const k in d) {
      if (k in this.serializers) {
        deserialized[k] = this.serializers[k].out(d[k])
      }
    }
    return deserialized
  }

  getQryParts(obj, prefix = "") {
    const OPS = {
      eq: "=",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
      ne: "!=",
      in: "IN",
      notin: "NOT IN",
      is: "IS",
      isnot: "IS NOT"
    }
    const fields = []
    const values = []
    const placeholders = []
    const operators = []
    const searchParams = []
    for (const k in obj) {
      const [fn, op = "eq"] = k.split("__")
      if (!(op in OPS)) {
        throw new Error(`Invalid operator: ${op}`)
      }
      const sfn = this.db.camelToSnake(fn);
      if (!this.tableFields.includes(sfn)) {
        throw new Error(`Field not found: ${sfn}, available fields are: ${JSON.stringify(this.tableFields)}`)
      }
      const field = `${prefix}${prefix ? "." : ""}${sfn}`
      if (k in this.serializers) {
        values.push(this.serializers[k].in(obj[k]))
      } else if (typeof obj[k] === "boolean") {
        values.push(obj[k] ? 1 : 0)
      } else {
        values.push(obj[k])
      }

      fields.push(field)
      placeholders.push("?")
      operators.push(OPS[op])
      searchParams.push(`${field} ${OPS[op]} ?`)
    }
    return {
      fields,
      values,
      operators,
      searchParams,
      placeholders: placeholders.join(","),
    }
  }
}

export class RecipientStore extends BaseStore {
  static create(dbAdapter) {
    return super.create(dbAdapter, "event_recipient")
  }
}

export class DeviceGraphEdgeStore extends BaseStore {
  static create(dbAdapter) {
    const serializers = {
      policy: { in: JSON.stringify, out: JSON.parse },
    }
    return super.create(dbAdapter, "device_graph_edge", serializers)
  }

  async get(srcDeviceId, dstDeviceId) {
    return this.deserialize(
      await this.db.readOne(
        `SELECT * from device_graph_edge where src_device_id = ? and dst_device_id = ?`,
        [srcDeviceId, dstDeviceId])
    );
  }

  async setPolicy(srcDeviceId, dstDeviceId, policy) {
    const d = await this.get(srcDeviceId, dstDeviceId)
    if (d) {
      const { values } = this.getQryParts({ policy, id: d.id })
      return await this.db.write(
        `UPDATE device_graph_edge set policy = ? where id = ?`
        , values)
    }
    const { fields, values, placeholders } = this.getQryParts({
      srcDeviceId, dstDeviceId, policy
    })
    await this.db.write(`
      INSERT INTO device_graph_edge (${fields.join(",")}) values (${placeholders})
    `, values)
  }

  async getGraph() {
    const graph = await this.db.read("SELECT * FROM device_graph_edge");
    return graph.map(edge => this.deserialize(edge));
  }
}

export class DeviceStore extends BaseStore {
  static create(dbAdapter) {
    const serializers = {
      signPublicKey: { in: serializeBin, out: deserializeBin },
      cryptPublicKey: { in: serializeBin, out: deserializeBin },
    }
    return super.create(dbAdapter, "device", serializers)
  }



  async get(id) {
    return this.deserialize(
      await this.db.readOne(`SELECT * from device where id = ? and revoked_at is null`, [id])
    );
  }


  async getMulti(ids) {
    const qry = `SELECT * from device where id in (${ids.map(d => "?").join(",")}) and revoked_at is null`
    const devices = await this.db.read(qry, ids)
    return devices.map(d => this.deserialize(d));
  }

  async getAll() {
    const qry = `SELECT * from device where revoked_at is null`
    const devices = await this.db.read(qry)
    return devices.map(d => this.deserialize(d));
  }

  async add(networkId, signPublicKey, cryptPublicKey, role = "user") {
    const id = makeId("dev", signPublicKey);
    const { fields, values, placeholders } = this.getQryParts({
      id, networkId, signPublicKey, cryptPublicKey, role
    })
    await this.db.write(
      `INSERT INTO device (${fields.join(",")}) VALUES (${placeholders})`,
      values
    )
    return id;

  }

  async import(deviceData, role = "user") {
    const { fields, values, placeholders } = this.getQryParts({
      ...deviceData, role
    })
    return this.db.write(
      `INSERT INTO device (${fields.join(',')}) VALUES (${placeholders})`,
      values
    )
  }

  async update(networkId, deviceId, updFields) {
    const { fields, values, placeholders } = this.getQryParts(updFields)
    const d = await this.get(deviceId)

    const pars = [...values, deviceId]
    if (d) {
      return await this.db.write(
        `UPDATE device set ${fields.map(f => `${f} = ?`).join(",")} where id = ?`
        , pars)
    }
    await this.db.write(`
      INSERT INTO device (network_id, ${fields.join(",")}, id) values (?,?,${placeholders})
    `, [networkId, ...pars])
  }

  async sync(devices) {
    for (const d of devices) {
      await this.db.write(
        `
        INSERT OR IGNORE INTO device (id, network_id, sign_public_key, crypt_public_key)
        VALUES
        (?, ?, ?, ?)
      `, [
        d.id,
        d.networkId,
        d.signPublicKey,
        null
      ])
    }
  }

}


export class EventStore extends BaseStore {

  static create(dbAdapter) {
    const serializers = {
      payloadKey: { in: serializeBin, out: deserializeBin },
      payload: { in: JSON.stringify, out: JSON.parse },
    }
    return super.create(dbAdapter, "event", serializers)
  }

  async get(id) {
    return this.deserialize(
      await this.db.readOne(`SELECT * from event where id = ?`, [id])
    );
  }

  async filter(filters = {}) {
    const eventFilters = Object.fromEntries(
      Object.keys(filters).filter(f => typeof filters[f] !== "object" || filters[f] === null)
        .map((key) => [key, filters[key]])
    )
    const relatedFilters = Object.fromEntries(
      Object.keys(filters).filter(f => !Object.keys(eventFilters).includes(f))
        .map((key) => [key, filters[key]])
    )

    const qp = this.getQryParts(eventFilters || {}, "e")
    const dqp = this.relatedStores.device.getQryParts(relatedFilters.device || {}, "d")
    const rqp = this.relatedStores.recipient.getQryParts(relatedFilters.recipient || {}, "er")
    const where = [
      qp.searchParams.join(' AND '),
      dqp.searchParams.join(' AND '),
      rqp.searchParams.join(' AND '),
    ].filter(v => Boolean(v)).join(" AND ")

    const qry = `SELECT e.*, er.device_id as recipientDeviceId from event e 
      left join event_recipient er on e.id = er.event_id
      left join device d on d.id = er.device_id
      where ${where || "1"}
      order by e.sequence DESC
    `
    // console.log(qry)
    const qryValues = [...qp.values, ...dqp.values, ...rqp.values]

    const events = await this.db.read(qry, qryValues)
    return events.map(d => this.deserialize(d));
  }

  async getByRcpt(id) {
    const events = await this.db.read(`
        SELECT * from 
        event e inner join event_recipient er on e.id = er.event_id
        inner join device d on d.id = er.device_id
        where d.id = ?
      `, [id])
    return events.map(d => this.deserialize(d));
  }

  async getByType(type) {
    const events = await this.db.read(`
        SELECT * from 
        event
        where type = ?
        order by sequence desc
      `, [type])
    return events.map(d => this.deserialize(d));
  }

  async getAll() {

    const events = await this.db.read(`
        SELECT * from 
        event
        where is_system = 0
        order by sequence desc
      `, [])
    return events.map(d => this.deserialize(d));
  }

  async getAllSystem() {
    const events = await this.db.read(`
        SELECT * from 
        event
        where is_system = 1
        order by sequence desc
      `, [])
    return events.map(d => this.deserialize(d));
  }

  async setSequence(eventId, sequence) {
    await this.db.write(`UPDATE event set sequence = ? where id = ?`, [sequence, eventId])
  }

  async add(networkId, type, recipients, senderDeviceId, payload, payloadKey, existingId, sequence, isSystem, isOutgoing, isIncoming, ts) {
    const serialized = serializeEvent(networkId, recipients, senderDeviceId, payload, ts);
    const id = existingId || makeIdFromStr("evt", serialized);
    const { fields, values, placeholders } = this.getQryParts({
      id, type, senderDeviceId, payload, payloadKey, sequence, isSystem, isOutgoing, isIncoming, timestamp: ts
    })
    // @TODO: Transaction here!!
    this.db.write(
      `INSERT INTO event (${fields.join(",")}) VALUES (${placeholders})`,
      values
    );

    for (const rcpt of recipients) {
      const qp = this.relatedStores.recipient.getQryParts({
        eventId: id, deviceId: rcpt.deviceId, encryptedPayloadKey: rcpt.encryptedPayloadKey
      })
      this.db.write(`
        INSERT INTO event_recipient (${qp.fields.join(",")})
        values
        (${qp.placeholders})
      `, qp.values)
    }
    return id;
  }

  async update(eventId, updFields) {
    const { fields, values } = this.getQryParts(updFields)
    return await this.db.write(
      `UPDATE event set ${fields.map(f => `${f} = ?`).join(",")} where id = ?`,
      [...values, eventId]
    )
  }
}


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


export class AppKVStore extends BaseStore {
  static create(dbAdapter) {
    return super.create(dbAdapter, "app_kv_store");
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
    return rows.map(r => ({key: r.key, value: JSON.parse(r.value)}));
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
