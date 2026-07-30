import { createSeptServer } from '@sept/server'
export { DORelay } from '@sept/server'


export default createSeptServer([
  {
    routes: [],
    events: {
      "event.received": eventData => {
        // console.log(eventData)
      }
    }
  }
])

