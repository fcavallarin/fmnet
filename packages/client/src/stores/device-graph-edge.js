import { BaseStore } from './base.js'
import {
  randomBytes,
  encryptSymmetric,
  decryptSymmetric
} from '@sept/crypto';

import { deserializeBin, makeId, serializeBin, makeIdFromStr, serializeEvent } from '@sept/core';



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
        `
        SELECT * from device_graph_edge where src_device_id = ? and dst_device_id = ?
        AND EXISTS (select 1 from device where id = ? and revoked_at is null)
        AND EXISTS (select 1 from device where id = ? and revoked_at is null)
        `,
        [srcDeviceId, dstDeviceId, srcDeviceId, dstDeviceId])
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
    const graph = await this.db.read(`
      SELECT e.*
      FROM device_graph_edge e
      JOIN device src
        ON src.id = e.src_device_id
        AND src.revoked_at IS NULL
      JOIN device dst
        ON dst.id = e.dst_device_id
        AND dst.revoked_at IS NULL
    `);
    return graph.map(edge => this.deserialize(edge));
  }
}
