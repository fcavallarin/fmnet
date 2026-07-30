import { AdminHandler } from "./event-handlers/admin.js";
import { PolicyHandler } from "./event-handlers/policy.js";


export class EventRouter {
  constructor(uiEvents, store){
    this.uiEvents = uiEvents;
    this.store = store;
  }
  async route(type, body){
    const [_, hname, ...evType] = type.split(".")
    const handlers = {
      admin: AdminHandler,
      policy: PolicyHandler
    };
    const handler = handlers[hname];
    const h = new handler(this.uiEvents, this.store, evType.join("."), body);
    await h.handle();
  }
}