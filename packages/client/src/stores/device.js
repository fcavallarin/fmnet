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
