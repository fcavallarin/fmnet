import { canonicalJson, deserializeBin, now } from "@sept/core";
import { verifyString } from "@sept/crypto";
import { BaseEventHandler } from './base.js'

export class DeviceHandler extends BaseEventHandler {

  async handle() {
    switch (this.event) {
      // case "share":  // @TODO probably unused
      //   const networkId = this.payload.networkId
      //   for (const d of this.payload.devices) {
      //     await this.update(networkId, d.deviceId, d.signPublicKey, d.cryptPublicKey)
      //     this.uiEvents.dispatch("device.share", {
      //       deviceId: d.deviceId,
      //       metadata: this.payload.metadata
      //     })
      //   }
      // break
      case "added":
        await this.store.device.import(this.payload)
        this.uiEvents.dispatch("sept.device.added", this.payload)
        break
      case "invalidated":
        await this.store.device.update(undefined, this.payload.deviceId, { revokedAt: now() })
        this.uiEvents.dispatch("sept.device.invalidated", this.payload)
        break
    }
  }

  // async update(networkId, deviceId, signPublicKey, cryptPublicKey) {
  //   await this.store.device.update(networkId, deviceId, { signPublicKey, cryptPublicKey })
  // }
}