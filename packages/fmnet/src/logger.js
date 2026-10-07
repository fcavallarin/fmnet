
export let DEBUG_LEVEL = "default"

const defaultLogger = {
  debug: m => {
    if (DEBUG_LEVEL == "debug") console.log(`DBG: ${m}`)
  },
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}

export let logger = defaultLogger

export function setLogger(customLogger) {
  logger = customLogger ?? defaultLogger
}

export function setLogLevel(level) {
  DEBUG_LEVEL = level ?? "default"
}