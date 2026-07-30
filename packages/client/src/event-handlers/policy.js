import { deserializeBin } from "@sept/core";
import { BaseEventHandler } from './base.js'

export class PolicyHandler extends BaseEventHandler {

  async handle() {
    switch (this.event) {
      case "update":
        const networkId = this.payload.networkId;
        await this.update(networkId, this.payload.srcDevice, this.payload.dstDevice, this.payload.policy);
    }
  }
  async update(networkId, srcDevice, dstDevice, policy) {
    const settings = await this.store.settings.get()
    if (settings.deviceId === srcDevice.deviceId) {
      await this.store.device.update(networkId, dstDevice.deviceId, {
        signPublicKey: deserializeBin(dstDevice.signPublicKey),
        cryptPublicKey: deserializeBin(dstDevice.cryptPublicKey)
      })
    }

    if (settings.deviceId === dstDevice.deviceId) {
      await this.store.device.update(networkId, srcDevice.deviceId, {
        signPublicKey: deserializeBin(srcDevice.signPublicKey),
        cryptPublicKey: deserializeBin(srcDevice.cryptPublicKey)
      })
    }

    await this.store.deviceGraphEdge.setPolicy(
      srcDevice.deviceId,
      dstDevice.deviceId,
      policy
    );
    this.uiEvents.dispatch("sept.policy.update", {
      srcDeviceId: srcDevice.deviceId,
      dstDeviceId: dstDevice.deviceId,
      metadata: this.payload.metadata
    })
  }

}