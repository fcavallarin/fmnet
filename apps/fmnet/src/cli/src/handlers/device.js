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
        this.log(`Paring pin: ${pin}`)
        break
      case 'grant':
        await this.fmnet.grant(args[1], args[2], args[3])
        break
      case "id":
        this.log(await this.fmnet.getDeviceId())
        break

      default:
        this.cli.log("Usage:")
        this.cli.log(this.usage())
    }
  }
  usage() {
    return [
      "  device list",
      "  device id"
    ].join("\n")
  }
}