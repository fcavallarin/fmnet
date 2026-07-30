import { BaseEventHandler } from './base.js'

export class AdminHandler extends BaseEventHandler {

  async handle() {
    const { networkId, deviceId } = this.payload;
    switch (this.event) {
      case "grant":
        await this.store.device.update(networkId, deviceId, { role: "admin" })
        break
      case "revoke":
        await this.store.device.update(networkId, deviceId, { role: "user" })
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