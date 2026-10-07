import { logger } from './logger.js';


export class EventBus {
  constructor(availableListeners) {
    this.listeners = {}
    for (const a of availableListeners) {
      this.listeners[a] = []
    }
  }

  getEventNames() {
    return Object.keys(this.listeners);
  }

  on(evName, handler) {
    this.listeners[evName].push(handler)
  }

  off(evName, handler) {
    const i = this.listeners[evName].indexOf(handler);
    if (i === -1) {
      throw new Error("event handler not found")
    }
    this.listeners[evName].splice(i, 1);
  }

  async dispatch(evName, params) {
    if (!Object.keys(this.listeners).includes(evName)) {
      throw new Error(`Event ${evName} not registered`)
    }
    for (const h of this.listeners[evName]) {
      await h(params)
    }
  }
}
