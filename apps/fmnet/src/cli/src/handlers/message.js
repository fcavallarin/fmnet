import { BaseHandler } from "./base.js";

export class MessageHandler extends BaseHandler {

  async handle(args) {
    const [subcommand, ...params] = args
    const [
      name,
      ...messageParts
    ] = params

    switch (subcommand) {
      case "send":
        if (!name || messageParts.length === 0) {
          throw new Error(
            'Usage: message send <name> "message"'
          )
        }
        const message = messageParts.join(" ")
        await this.fmnet.sendMessage(name, message)
        this.cli.success(`Message sent to ${name}`)
        break
      case "unreads":
        for (const m of await this.fmnet.getNewMessages()) {
          this.cli.info(`[message from ${JSON.stringify(m)}]`)
        }
        break

      default:
        this.cli.log("Usage:")
        this.cli.log(this.usage())
    }
  }
  usage() {
    return [
      "  message send <name> \"message\"",
      "  message unreads",
    ].join("\n")
  }
}