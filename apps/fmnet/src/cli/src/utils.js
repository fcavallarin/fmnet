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

export function formatMessage(ui, message) {
  const sender = message.sender ?? "unknown"

  const text = message.message
  const date = formatTimestamp(message.timestamp)

  return `» ${ui.muted(date)} from ${ui.title(sender)}: ${text}`

}