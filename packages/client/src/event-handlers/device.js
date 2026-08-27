import { canonicalJson, deserializeBin, now } from "@sept/core";
import { verifyString } from "@sept/crypto";
import { BaseEventHandler } from './base.js'

export class DeviceHandler extends BaseEventHandler {

  async handle() {
    switch (this.event) {
      case "added":
        await this.store.device.add(this.payload)
        this.uiEvents.dispatch("sept.device.added", this.payload)
        break
      case "invalidated":
        await this.store.device.upsert(this.payload.deviceId, { revokedAt: now() })
        this.uiEvents.dispatch("sept.device.invalidated", this.payload)
        break
    }
  }
}