import { deserializeBin } from "@sept/core";
import { BaseEventHandler } from './base.js'

export class PolicyHandler extends BaseEventHandler {

  async handle() {
    switch (this.event) {
      case "update":
        const networkId = this.payload.networkId;
        const localNetwork = await this.store.network.get();

        if (!localNetwork || networkId !== localNetwork.id) {
          throw new Error("Policy update belongs to a different network");
        }
        await this.update(networkId, this.payload.devices, this.payload.policies)

        this.uiEvents.dispatch("sept.policy.update", {
          policies: this.payload.policies,
          metadata: this.payload.metadata,
        })
        break
    }
  }
  async update(networkId, devices, policies) {
    const settings = await this.store.settings.get()
    for (const d of devices) {

      if (settings.deviceId !== d.id) {
        await this.store.device.upsert(d.id, {
          networkId,
          signPublicKey: deserializeBin(d.signPublicKey),
          cryptPublicKey: deserializeBin(d.cryptPublicKey)
        })
      }
    }

    for (const p of policies) {
      const { srcDeviceId, dstDeviceId, policy } = p
      await this.store.deviceGraphEdge.setPolicy(
        srcDeviceId,
        dstDeviceId,
        policy
      );
    }
  }

}