import readline from "node:readline"
import process from "node:process"
import { execFile } from "node:child_process";
import { readFileSync } from 'node:fs';
import { MessageHandler } from "./handlers/message.js"
import { TunnelHandler } from "./handlers/tunnel.js"
import { DeviceHandler } from "./handlers/device.js"
import { formatMessage } from "./utils.js"

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[94m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
}

const colorsEnabled =
  process.stdout.isTTY &&
  !process.env.NO_COLOR

function paint(value, ...styles) {
  if (!colorsEnabled) {
    return String(value)
  }

  return `${styles.join("")}${value}${ansi.reset}`
}

const ui = {
  title: value => paint(value, ansi.bold, ansi.cyan),
  success: value => paint(value, ansi.green),
  warning: value => paint(value, ansi.yellow),
  error: value => paint(value, ansi.red),
  info: value => paint(value, ansi.blue),
  muted: value => paint(value, ansi.gray),
}

function readJsonFile(path) {
  return JSON.parse(
    readFileSync(path, 'utf8')
  );
}


export class FmnetCli {
  constructor(fmnet) {
    this.fmnet = fmnet
    this.running = false
    this.executing = false
    this.ui = ui

    this.messageHandler = new MessageHandler(fmnet, this)
    this.deviceHandler = new DeviceHandler(fmnet, this)
    this.tunnelHandler = new TunnelHandler(fmnet, this)

    this.prompt = paint("fmnet>", ansi.bold, ansi.cyan) + " "

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 100,
      removeHistoryDuplicates: true,
      prompt: this.prompt,
    })
  }

  async start() {
    this.running = true

    this.registerCustomActions('./custom-actions.json')
    this.registerFmnetEvents()
    this.registerReadlineEvents()
    this.printBanner()
    await this.fmnet.sync()
    this.rl.prompt()
  }

  registerFmnetEvents() {
    this.fmnet.on?.("message", message => {
      this.info(formatMessage(ui, message))
    })

    // this.fmnet.on?.("tunnel.opened", tunnel => {
    //   this.success(`Tunnel opened: ${tunnel.tunnelId}`)
    // })

    // this.fmnet.on?.("tunnel.closed", tunnel => {
    //   this.warning(`Tunnel closed: ${tunnel.tunnelId}`)
    // })
  }

  registerCustomActions(configPath) {
    const septClient = this.fmnet.septClient
    const config = readJsonFile(configPath)
    septClient.register("customaction.response", (data, senderDeviceId) => {
      this.info(`Action response: ${data}`)
    })
    for (const action of config.actions) {
      septClient.register(`customaction.${action.name}`, async (data, senderDeviceId) => {
        const deviceName = await this.fmnet.getDeviceIdentity(senderDeviceId)
        try {
          this.info(`Action '${action.name}' requested by ${deviceName.name}`)
          const { stdout } = execFile(action.command, data.args)
          septClient.sendEvent("customaction.response", "ok", [senderDeviceId])
        } catch (e) {
          septClient.sendEvent("customaction.response", `error: ${e.code}`, [senderDeviceId])
        }
      })
    }
  }

  registerReadlineEvents() {
    this.rl.on("line", line => {
      void this.handleLine(line)
    })

    this.rl.on("SIGINT", () => {
      if (this.rl.line.length > 0) {
        // First Ctrl+C clears the current command.
        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)

        this.rl.write(null, {
          ctrl: true,
          name: "u",
        })

        this.rl.prompt()
        return
      }

      this.stop()
    })

    this.rl.on("close", () => {
      this.running = false
    })
  }

  async handleLine(line) {
    const input = line.trim()

    if (!input) {
      this.rl.prompt()
      return
    }

    if (this.executing) {
      this.warning("A command is already running")
      this.rl.prompt()
      return
    }

    this.executing = true

    try {
      await this.execute(input)
    } catch (error) {
      this.error(error?.message ?? String(error))
    } finally {
      this.executing = false

      if (this.running) {
        this.rl.prompt()
      }
    }
  }

  async execute(input) {
    const [command, ...args] = this.parse(input)

    switch (command) {
      case "help":
        this.printHelp()
        break

      case "device":
      case "devices":
        await this.deviceHandler.handle(args)
        break

      case "tunnel":
        await this.tunnelHandler.handle(args)
        break

      case "message":
        await this.messageHandler.handle(args)
        break

      case "sync":
        await this.fmnet.sync()
        this.success("Sync completed")
        break
      case "whoami":
        const i = await this.fmnet.getLocalIdentity()
        this.success(`ID: ${i.deviceId}\nname: ${i.name}`)
        break
      case "permissions":
        for (const g of await this.fmnet.getDeviceGraph()) {
          const sn = await this.fmnet.getDeviceIdentity(g.srcDeviceId)
          const dn = await this.fmnet.getDeviceIdentity(g.dstDeviceId)
          this.success(`${sn.name} → ${dn.name} ${g?.policy?.allowedActions.join(",")}`)
        }
        break
      case "status":
        this.success(`Status:\n Relay: ${this.fmnet.getRelayStatus()}`)
        break
      case "run-action":
        await this.fmnet.sendEvent(args[0], `customaction.${args[1]}`, { args: [] })
        this.success(`Action requested`)
        break
      case "clear":
        console.clear()
        break

      case "exit":
      case "quit":
        this.stop()
        break

      default:
        this.warning(`Unknown command: ${command}`)
        this.log(`Type ${ui.title("help")} to list available commands.`)
    }
  }


  /**
   * Prints an asynchronous message without destroying the command
   * currently being typed.
   */
  printAsync(message) {
    if (!this.running || !process.stdout.isTTY) {
      process.stdout.write(`${message}\n`)
      return
    }

    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)

    process.stdout.write(`${message}\n`)

    this.rl.prompt(true)
  }

  log(message) {
    this.printAsync(String(message))
  }

  info(message) {
    this.printAsync(ui.info(message))
  }

  success(message) {
    this.printAsync(ui.success(message))
  }

  warning(message) {
    this.printAsync(ui.warning(message))
  }

  error(message) {
    this.printAsync(ui.error(`Error: ${message}`))
  }

  parse(input) {
    const tokens = []
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g

    let match

    while ((match = regex.exec(input)) !== null) {
      tokens.push(
        match[1] ??
        match[2] ??
        match[3]
      )
    }

    return tokens
  }



  printBanner() {
    this.log("")
    this.log(ui.title("FMNet interactive CLI"))
    this.log(
      ui.muted('Type "help" to list available commands.')
    )
    this.log("")
  }

  printHelp() {
    this.log(`
${ui.title("Commands")}

  ${ui.title("help")}
  ${ui.title("status")}

  ${ui.title("sync")}
  ${ui.title("whoami")}
  ${ui.title("permissions")}
  ${ui.title("clear")}
  ${ui.title("exit")}

  run-action <device-name> <action-name>

${this.deviceHandler.usage()}

${this.tunnelHandler.usage()}

${this.messageHandler.usage()}
  
  
`)
  }

  stop() {
    if (!this.running) {
      return
    }

    this.running = false

    process.stdout.write("\n")
    this.rl.close()
    this.fmnet.shutdown()

  }
}