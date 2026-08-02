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

      case "close-datachannel":
        await this.closeDatachannel(params)
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
      "  tunnel close-datachannel <datachannel-id>",
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

    const i = await this.fmnet.getLocalIdentity()
    const hasTunPermission = await this.fmnet.hasTcpTunnelPermission(i.name, deviceName)
    if(!hasTunPermission){
      throw new Error(`Current device has no permission to open tunnel to ${deviceName}`)
    }
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

  async closeDatachannel(args) {
    const [dcId] = args

    if (!dcId) {
      throw new Error(
        "Usage: tunnel close-datachannel <datachannel-id>"
      )
    }

    const tunnels = this.fmnet.getActiveTcpTunnels()
    if(!tunnels[dcId]){
      throw new Error("DataChannel is not active")
    }

    if(tunnels[dcId].length > 0){
      throw new Error("DataChannel has active tunnels")
    }

    await this.fmnet.closeDataChannel(dcId)
    this.cli.success(`DataChannel closed: ${dcId}`)
  }


  list() {
    const tunnels = this.fmnet.getActiveTcpTunnels()

    if (!tunnels || Object.keys(tunnels).length === 0) {
      this.cli.log(this.cli.ui.muted("No active tunnels"))
      return
    }

    for (const dcmId in tunnels) {
      this.cli.log(
        this.cli.ui.title(`● DataChannel ID: ${dcmId}`)
      )
      let i = 0
      for (const tunnel of tunnels[dcmId]) {
        const c = ++i == tunnels[dcmId].length ? "└─" : "├─"
        this.cli.log(
          `${c} ${this.cli.ui.success("active")} ` +
          `${this.cli.ui.title(tunnel.role)} ` +
          `${this.cli.ui.muted(tunnel.id)}`
        )
      }
    }
  }

}