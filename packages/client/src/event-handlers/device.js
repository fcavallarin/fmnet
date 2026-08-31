import { canonicalJson, deserializeBin, now } from "@sept/core";
import { verifyString } from "@sept/crypto";
import { BaseEventHandler } from './base.js'

export class DeviceHandler extends BaseEventHandler {

  async handle() {
    switch (this.event) {
      case "add":
        await this.store.device.add({
          id: this.payload.id,
          networkId: this.payload.networkId,
          signPublicKey: deserializeBin(this.payload.signPublicKey),
          cryptPublicKey: deserializeBin(this.payload.cryptPublicKey),
        })
        this.uiEvents.dispatch("sept.device.add", this.payload)
        break
      case "invalidate":
        await this.store.device.upsert(this.payload.deviceId, { revokedAt: now() })
        this.uiEvents.dispatch("sept.device.invalidate", this.payload)
        break
    }
  }
}