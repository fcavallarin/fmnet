
export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}


export function now() {
  return Math.floor(Date.now() / 1000);
}


export function isExpired(ts, w) {
  return now() >= ts + w;
}
