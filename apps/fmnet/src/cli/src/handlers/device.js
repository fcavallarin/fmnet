import { BaseHandler } from "./base.js";

export class DeviceHandler extends BaseHandler {
  async handle(args) {
    const [subcommand] = args

    switch (subcommand) {
      case "list": {
        const graph = await this.fmnet.getDeviceGraph()

        if (!graph?.length) {
          this.cli.log(this.cli.ui.muted("No devices"))
          return
        }

        console.dir(graph, {
          depth: null,
          colors: colorsEnabled,
        })

        break
      }

      case "add":
        const j = Buffer.from(args[1], "base64").toString("utf8")
        const pin = await this.fmnet.addDevice(JSON.parse(j))
        this.cli.log(`Paring pin: ${pin}`)
        break
      case 'grant':
        await this.fmnet.grant(args[1], args[2], args[3])
        break
      case "id":
        this.cli.log(await this.fmnet.getDeviceId())
        break
      case 'grant-tunnel':
        await this.fmnet.grantDataChannel(args[1], args[2])
        await this.fmnet.grantTcpTunnel(args[1], args[2])
        break

      default:
        this.cli.log("Usage:")
        this.cli.log(this.usage())
    }
  }
  usage() {
    return [
      "  device grant from-name to-name permission",
      "  device grant-tunnel from-name to-name",
      "  device list",
      "  device id"
    ].join("\n")
  }
}