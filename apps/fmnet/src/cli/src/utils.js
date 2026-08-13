export function formatTimestamp(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

export function formatMessage(ui, message, includeSender = true) {
  const sender = message.sender ?? "unknown"

  const text = message.message
  const date = formatTimestamp(message.timestamp)
  const i = message.isIncoming ? "<" : ">"
  const s = includeSender ? ` from ${ui.title(sender)}` : "" 
  return `${ui.muted(date)}${s} ${i}: ${text}`

}