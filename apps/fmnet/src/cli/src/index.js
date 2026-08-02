// import { terminal as term } from "terminal-kit";
import { FMNet } from "../../../src/fmnet.js";

import { webRTCAdapter, TCPAdapter } from "../../../src/adapters/node/net-adapters.js";
import Database from 'better-sqlite3';
import { FmnetCli } from './fmnet-cli.js'

import readline from "node:readline/promises"
import { stdin, stdout } from "node:process"



async function main() {
  const dbName = process.env.DBNAME || "app"
  const fmnet = await FMNet.create({
    webRTCAdapter: webRTCAdapter,
    tcpAdapter: new TCPAdapter(),
    logLevel: "debug",
    // restEndpoint: "https://sept.filippo-572.workers.dev",
    secretKeyProvider: async () => new Uint8Array(32),
    dataStore: {
      type: "better-sqlite",
      open: () => {
        const db = new Database(`./data/${dbName}.db`);
        db.pragma('journal_mode = WAL');
        return db;
      },
      close: (store) => store.close(),
    }
  })
  const networkId = await fmnet.getNetworkId()

  if (!networkId) {
    const rl = readline.createInterface({
      input: stdin,
      output: stdout,
    })

    const deviceName = await rl.question("Insert your name: ")

    let initAction
    while (true) {
      console.log("Device not paired\nWhat do you want to do?\n1. Create a new network\n2. Join a network\n")
      initAction = await rl.question("Select option: ")
      if (initAction == "1") {
        await fmnet.bootstrap(deviceName)
        break
      }
      if (initAction == "2") {
        const deviceData = await fmnet.initDevice(deviceName)

        console.log("Your pairing data:\n")
        const b64 = Buffer.from(JSON.stringify(deviceData)).toString("base64")
        console.log(b64)
        const pin = await rl.question("Pairing PIN: ")
        await fmnet.getPairing(pin)
        break
      }
    }
    rl.close()
  }
  console.log("Connecting ... \n")
  await fmnet.relayConnect()
  const cli = new FmnetCli(
    fmnet
  )
  await cli.start()
  
}

main()