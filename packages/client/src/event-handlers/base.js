
export class BaseEventHandler {
  constructor(uiEvents, store, event, payload) {
    this.uiEvents = uiEvents;
    this.store = store;
    this.event = event;
    this.payload = payload;
  }
}