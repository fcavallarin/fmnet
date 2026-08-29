import { BaseStore } from './base.js'
import {
  randomBytes,
  encryptSymmetric,
  decryptSymmetric
} from '@sept/crypto';

import { deserializeBin, makeId, serializeBin, makeIdFromStr, serializeEvent } from '@sept/core';



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

  async getAdmins() {
    const qry = `SELECT * from device where revoked_at is null and role = 'admin'`
    const devices = await this.db.read(qry)
    return devices.map(d => this.deserialize(d));
  }

  async create(deviceData) {
    const id = makeId("dev", deviceData.signPublicKey);
    await this.add({ ...deviceData, id })
    return id
  }

  async add(deviceData) {
    const { fields, values, placeholders } = this.getQryParts(deviceData)
    return this.db.write(
      `INSERT INTO device (${fields.join(',')}) VALUES (${placeholders})`,
      values
    )
  }

  async upsert(deviceId, data) {
    if ("id" in data) {
      throw new Error("upsert data must not contain id")
    }

    const { fields, values } = this.getQryParts(data)
    const res = await this.db.write(
      `UPDATE device set ${fields.map(f => `${f} = ?`).join(",")} where id = ?`
      , [...values, deviceId]
    )

    if (res.changes === 0) {
      await this.add({ ...data, id: deviceId })
    }
  }

}
