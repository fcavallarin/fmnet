import { BaseStore } from './base.js'
import {
  randomBytes,
  encryptSymmetric,
  decryptSymmetric
} from '@sept/crypto';

import { deserializeBin, makeId, serializeBin, makeIdFromStr, serializeEvent } from '@sept/core';


export class RecipientStore extends BaseStore {
  static create(dbAdapter) {
    return super.create(dbAdapter, "event_recipient")
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
      Object.keys(filters).filter(f => Array.isArray(filters[f]) || typeof filters[f] !== "object" || filters[f] === null)
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
