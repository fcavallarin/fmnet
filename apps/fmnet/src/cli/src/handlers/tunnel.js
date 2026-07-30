import { BaseHandler } from "./base.js";

export class TunnelHandler extends BaseHandler {
  async handle(args) {
    const [subcommand, ...params] = args

    switch (subcommand) {
      case "open":
        await this.open(params)
        break

      case "close":
        await this.close(params)
        break

      case "list":
        this.list()
        break

      default:
        this.cli.log("Usage:")
        this.cli.log(this.usage())
    }
  }

  usage() {
    return [
      "  tunnel open <device-name> <host> <port> [local-port]",
      "  tunnel close <tunnel-id>",
      "  tunnel list"
    ].join("\n")
  }

  parsePort(value) {
    const port = Number(value)

    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error(`Invalid port: ${value}`)
    }

    return port
  }

  async open(args) {
    const [
      deviceName,
      host,
      portString,
      localPortString,
    ] = args

    if (!deviceName || !host || !portString) {
      throw new Error(
        "Usage: tunnel open <device-name> <host> <port> [local-port]"
      )
    }

    const port = this.parsePort(portString)

    const localPort = localPortString
      ? this.parsePort(localPortString)
      : undefined

    this.cli.log(
      this.cli.ui.muted(
        `Opening tunnel to ${deviceName} ${host}:${port}...`
      )
    )

    const tunnelId = await this.fmnet.openTcpTunnel(
      deviceName,
      host,
      port,
      localPort
    )

    this.cli.success(`Tunnel opened: ${tunnelId}`)
  }

  async close(args) {
    const [tunnelId] = args

    if (!tunnelId) {
      throw new Error(
        "Usage: tunnel close <tunnel-id>"
      )
    }

    await this.fmnet.closeTcpTunnel(tunnelId)
    this.cli.success(`Tunnel closed: ${tunnelId}`)
  }

  list() {
    const tunnels = this.fmnet.tcpTunnels

    if (!tunnels || tunnels.size === 0) {
      this.log(ui.muted("No active tunnels"))
      return
    }

    for (const [tunnelId, tunnel] of tunnels) {
      const role =
        tunnel.role ??
        (tunnel.ingress ? "ingress" : "egress")

      this.cli.log(
        `${this.cli.ui.success("● active")} ` +
        `${this.cli.ui.title(role)} ` +
        `${this.cli.ui.muted(tunnelId)}`
      )
    }
  }

}