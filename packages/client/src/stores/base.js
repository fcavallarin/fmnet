
import {
  randomBytes,
  encryptSymmetric,
  decryptSymmetric
} from '@sept/crypto';

import { deserializeBin, makeId, serializeBin, makeIdFromStr, serializeEvent } from '@sept/core';


export async function resetDb(db) {
  await db.write(`DROP TABLE network`);
  await db.write(`DROP TABLE setting`);
  await db.write(`DROP TABLE device`);
  await db.write(`DROP TABLE event`);
  await db.write(`DROP TABLE event_recipient`);
  await db.write(`DROP TABLE device_graph_edge`);
  await db.write(`DROP TABLE app_kv_store`);
  await createTables(db)

}

export async function initDb(db, force = false) {

  if (force) {
    try {
      await resetDb(db)
      await db.write(`PRAGMA user_version = 0`);
    } catch { }
  }

  const dbVersion = (await db.readOne('PRAGMA user_version')).userVersion

  if (dbVersion > 0) {
    return
  }

  await db.write(`PRAGMA user_version = 1`);

  await createTables(db)

}

async function createTables(db) {
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

export class BaseStore {
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
      let pn
      if (k in this.serializers) {
        values.push(this.serializers[k].in(obj[k]))
      } else if (typeof obj[k] === "boolean") {
        values.push(obj[k] ? 1 : 0)
      } else if (Array.isArray(obj[k])) {
        values.push(...obj[k])
        pn = obj[k].length
      } else {
        values.push(obj[k])
      }

      fields.push(field)
      const pl = (op === "in" || op === "notin")
        ? "(" + Array(pn).fill("?").join(",") + ")"
        : "?"

      placeholders.push(pl)
      operators.push(OPS[op])
      searchParams.push(`${field} ${OPS[op]} ${pl}`)
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
