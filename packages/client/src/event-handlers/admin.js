import { deserializeBin } from '@sept/core';
import { BaseEventHandler } from './base.js'

export class AdminHandler extends BaseEventHandler {

  async handle() {
    const { networkId, deviceId, signPublicKey, cryptPublicKey } = this.payload;

    switch (this.event) {
      case "grant":
        const deviceData = {
          networkId,
          signPublicKey: deserializeBin(signPublicKey),
          cryptPublicKey: deserializeBin(cryptPublicKey),
          role: "admin"
        }
        await this.store.device.upsert(deviceId, deviceData)
        break
      case "revoke":
        await this.store.device.upsert(deviceId, { role: "user" })
        break
      default:
        throw new Error(`Unknowd admin action: ${this.event}`)
    }
    this.uiEvents.dispatch(`sept.admin.${this.event}`, {
      deviceId: deviceId,
      metadata: this.payload.metadata
    })
  }


}