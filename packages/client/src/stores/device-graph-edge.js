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
