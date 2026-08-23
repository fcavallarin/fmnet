import { AdminHandler } from "./event-handlers/admin.js";
import { PolicyHandler } from "./event-handlers/policy.js";
import { DeviceHandler } from "./event-handlers/device.js";


export class EventRouter {
  constructor(uiEvents, store){
    this.uiEvents = uiEvents;
    this.store = store;
  }
  async route(type, body){
    const [_, hname, ...evType] = type.split(".")
    const handlers = {
      admin: AdminHandler,
      policy: PolicyHandler,
      device: DeviceHandler,
    };
    const handler = handlers[hname];
    // console.log("--->", type, body)
    const h = new handler(this.uiEvents, this.store, evType.join("."), body);
    await h.handle();
  }
}