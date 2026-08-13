import { formatMessage } from "../utils.js";
import { BaseHandler } from "./base.js";

export class MessageHandler extends BaseHandler {

  async handle(args) {
    const [subcommand, ...params] = args
    const [
      name,
      ...messageParts
    ] = params
    let messages
    switch (subcommand) {
      case "send":
        if (!name || messageParts.length === 0) {
          throw new Error(
            'Usage: message send <name> "message"'
          )
        }
        const i = await this.fmnet.getLocalIdentity()
        const hasMsgPermission = await this.fmnet.hasPermission(i.name, name, "message")
        if (!hasMsgPermission) {
          throw new Error(`Current device (${i.name}) has no permission to send messages to ${name}`)
        }
        const message = messageParts.join(" ")
        await this.fmnet.sendMessage(name, message)
        this.cli.success(`Message sent to ${name}`)
        break
      case "unreads":
        messages = await this.fmnet.getNewMessages()
        messages.reverse()
        for (const m of messages) {
          this.cli.info(formatMessage(this.cli.ui, m))
        }
        break

      case "list":
        messages = name
          ? await this.fmnet.getMessagesFrom(name)
          : await this.fmnet.getMessages()
        messages.reverse()
        for (const m of messages) {
          this.cli.info(formatMessage(this.cli.ui, m))
        }
        break

      case "get-chat-from":
        if(!name){
          throw new Error("missing name")
        }
        messages = await this.fmnet.getConversationFrom(name)
        messages.reverse()
        for (const m of messages) {
          this.cli.info(formatMessage(this.cli.ui, m, false))
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
      "  message list [sender-name]",
      "  message get-chat-from sender-name",
      "  message unreads",
    ].join("\n")
  }
}