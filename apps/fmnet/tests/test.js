import { randomDigits } from "../../../packages/crypto/src/random.js";
import { FMNet } from "../src/fmnet.js";
import Database from 'better-sqlite3';
import { webRTCAdapter, TCPAdapter } from "../src/adapters/node/net-adapters.js";

function assert(cond, err) {
  if (!cond) {
    throw new Error(err)
  }
}

async function sleep(ms) {
  await new Promise(r => setTimeout(r, ms))
}

class FMnetTest {
  async init() {
    function createDs(name) {
      return {
        type: "better-sqlite",
        open: () => {
          const db = new Database(`./data/${name}.db`);
          db.pragma('journal_mode = WAL');
          return db;
        },
        close: (store) => store.close(),
      }
    }
    this.tcpTunnel = null;
    const options = {
      webRTCAdapter: webRTCAdapter,
      tcpAdapter: new TCPAdapter(),
      secretKeyProvider: async () => new Uint8Array(32),
      logLevel: "debug"
    }
    this.appAdmin = await FMNet.create({
      ...options,
      dataStore: createDs("admin"),
    }
    )
    this.appDevice1 = await FMNet.create({
      ...options,
      dataStore: createDs("cl1"),
    }
    )
    this.appDevice2 = await FMNet.create({
      ...options,
      dataStore: createDs("cl2"),
    })
  }

  async sent_mess_and_assert(srcDevKey, dstDevKey, message) {
    const umess = `${message}-${randomDigits(6)} (${srcDevKey} -> ${dstDevKey}) ⚡😎 ⚡`
    await this[`app${srcDevKey}`].sendMessage(this[`app${dstDevKey}Name`], umess)
    await this[`app${dstDevKey}`].sync()
    const storedMessages = await this[`app${dstDevKey}`].getStoredActions({
      payload: umess
    })
    const mess = storedMessages[0]
    assert(mess, `${dstDevKey} didn't get the message ${umess} -> ${JSON.stringify(storedMessages)}`)
  }


  async test_bootstrap_and_add_devices(testId) {
    this.appAdminName = "admin"
    await this.appAdmin.bootstrap(this.appAdminName)
    console.log(`Bootstrap done`)

    this.appDevice1Name = "user1"
    const device1Data = await this.appDevice1.initDevice(this.appDevice1Name)
    console.log(`Init device1 done`)
    const pin1 = await this.appAdmin.addDevice(device1Data)
    console.log(`Device1 added`)

    await this.appDevice1.getPairing(pin1)
    console.log(`Device 1 paired with pin ${pin1}`)

    this.appDevice2Name = "user2"
    const device2Data = await this.appDevice2.initDevice(this.appDevice2Name)
    console.log(`Init device2 done`)
    const pin2 = await this.appAdmin.addDevice(device2Data)
    console.log(`Device2 added`)
    await this.appDevice2.getPairing(pin2)
    console.log(`Device 2 paired`)

    this.appAdminDeviceId = await this.appAdmin.getDeviceId()
    this.appDevice1DeviceId = await this.appDevice1.getDeviceId()
    this.appDevice2DeviceId = await this.appDevice2.getDeviceId()

    await this.appAdmin.grant(
      this.appDevice1Name,
      this.appDevice2Name,
      "message",
      {
        srcName: this.appDevice1Name,
        dstName: this.appDevice2Name,
      }
    );

    await this.appAdmin.grant(
      this.appDevice1Name,
      this.appAdminName,
      "message",
      {
        srcName: this.appDevice1Name,
        dstName: this.appAdminName,
      }
    );
    console.log(`Policy updated`)

    await this.appDevice1.sync()
    console.log(`Device 1 sync done`)
    await this.appDevice2.sync()
    console.log(`Device 2 sync done`)

    const policy1Admin = await this.appDevice1.getPolicy(this.appDevice1DeviceId, this.appAdminDeviceId)
    assert(
      policy1Admin.allowedActions.includes("message"),
      `Device1: Device1 policy error to Admin: ${JSON.stringify(policy1Admin)}`
    )

    const policyAdmin1 = await this.appAdmin.getPolicy(this.appDevice1DeviceId, this.appAdminDeviceId)
    assert(
      policyAdmin1.allowedActions.includes("message"),
      `Admin: Device1 policy error to Admin: ${JSON.stringify(policy1Admin)}`
    )


    const policy12 = await this.appDevice1.getPolicy(this.appDevice1DeviceId, this.appDevice2DeviceId)
    assert(
      policy12.allowedActions.includes("message"),
      `Device1 policy error to Device2: ${JSON.stringify(policy12)}`
    )
    console.log(`Policy check OK `)

    let devs
    devs = await this.appAdmin.getIdentityDevices(this.appDevice1Name)
    assert(
      devs.length === 1,
      `Admin: ${this.appDevice1Name} has more than 1 device: ${JSON.stringify(devs)}`
    )
    assert(
      devs[0] === this.appDevice1DeviceId,
      `Admin: ${this.appDevice1Name} has the wrong device id ${this.appDevice1DeviceId}`
    )

    devs = await this.appDevice1.getIdentityDevices(this.appAdminName)
    assert(
      devs.length === 1,
      `Device1: ${this.appAdminName} has more than 1 device: ${JSON.stringify(devs)}`
    )
    assert(
      devs[0] === this.appAdminDeviceId,
      `Device1: ${this.appAdminName} has the wrong device id ${this.appDevice1DeviceId}`
    )

    devs = await this.appDevice1.getIdentityDevices(this.appDevice2Name)
    assert(
      devs.length === 1,
      `Device1: ${this.appDevice2Name} has more than 1 device: ${JSON.stringify(devs)}`
    )
    assert(
      devs[0] === this.appDevice2DeviceId,
      `Device1: ${this.appDevice2Name} has the wrong device id ${this.appDevice1DeviceId}`
    )


    devs = await this.appDevice2.getIdentityDevices(this.appAdminName)
    assert(
      devs.length === 1,
      `Device2: ${this.appAdminName} has more than 1 device: ${JSON.stringify(devs)}`
    )
    assert(
      devs[0] === this.appAdminDeviceId,
      `Device2: ${this.appAdminName} has the wrong device id ${this.appDevice1DeviceId}`
    )

    devs = await this.appDevice2.getIdentityDevices(this.appDevice1Name)
    assert(
      devs.length === 1,
      `Device2: ${this.appDevice1Name} has more than 1 device: ${JSON.stringify(devs)}`
    )
    assert(
      devs[0] === this.appDevice1DeviceId,
      `Device2: ${this.appDevice1Name} has the wrong device id ${this.appDevice1DeviceId}`
    )
  }

  async test_send_messages(testId) {
    await this.sent_mess_and_assert("Admin", "Device1", testId)
    console.log(`Message sent admin -> device1`)

    await this.sent_mess_and_assert("Device1", "Device2", testId)
    console.log(`Message sent device1 -> device2`)

    await this.sent_mess_and_assert("Device1", "Admin", testId)
    console.log(`Message sent device1 -> admin`)

    let failed = false
    try {
      console.log("> Ignore message below:")
      await this.appDevice2.sendMessage(this.appAdminName, "test4")
    } catch {
      failed = true
    }

    assert(failed, "Device2 should not be allowed to send messages to Admin")

    await this.appAdmin.revoke(
      this.appDevice1Name,
      this.appAdminName,
      "message",
    );
    await this.appDevice1.sync()

    failed = false
    try {
      console.log("> Ignore message below:")
      await this.appDevice1.sendMessage(this.appAdminName, "test5")
    } catch {
      failed = true
    }
    assert(failed, "Device1 should not be allowed to send messages to Admin (after revoke)")
  }

  async test_local_identity(testId) {
    const iDeviceAdmin = await this.appAdmin.getLocalIdentity()
    assert(iDeviceAdmin.name === "admin", `Admin name is set to ${iDeviceAdmin.name}`)

    const iDevice1 = await this.appDevice1.getLocalIdentity()
    assert(iDevice1.name === this.appDevice1Name, `Device1 name is set to ${iDevice1.name}`)

    const iDevice2 = await this.appDevice2.getLocalIdentity()
    assert(iDevice2.name === this.appDevice2Name, `Device2 name is set to ${iDevice2.name}`)
  }



  async test_get_new_messages(testId) {

    let newMessages
    await this.sent_mess_and_assert("Device1", "Device2", testId)
    newMessages = await this.appDevice2.getNewMessages()
    assert(newMessages.length > 0, "No new messages 1")

    await this.sent_mess_and_assert("Device1", "Device2", testId)

    newMessages = await this.appDevice2.getNewMessages()
    assert(newMessages.length === 1, "No new messages 2 " + JSON.stringify(newMessages))

  }

  async test_tunnel(testId) {
    await this.appDevice1.relayConnect()
    await this.appDevice2.relayConnect()

    await this.appAdmin.grantDataChannel(this.appDevice1Name, this.appDevice2Name)
    await this.appAdmin.grantTcpTunnel(this.appDevice1Name, this.appDevice2Name)

    const tunnelId = await this.appDevice1.openTcpTunnel(
      this.appDevice2Name,
      "127.0.0.1",
      1122,
      1123
    )

    let tunData = ""

    const cli = new TCPAdapter()
    const ser = new TCPAdapter()
    const sser = await ser.listen("127.0.0.1", 1122, sok => {
      sok.onData(d => {
        tunData = `${d}`
      })
    })

    const clsok = await cli.connect("127.0.0.1", 1123)

    clsok.write("hi")

    await sleep(200)
    assert(tunData === "hi", `Wrong tunData = ${tunData}`)

    const testTunnel2 = true
    let tunnelId2

    tunnelId2 = await this.appDevice1.openTcpTunnel(
      this.appDevice2Name,
      "127.0.0.1",
      1222,
      1223
    )

    let tunData2 = ""

    const cli2 = new TCPAdapter()
    const ser2 = new TCPAdapter()
    const sser2 = await ser2.listen("127.0.0.1", 1222, sok => {
      sok.onData(d => {
        tunData2 = `${d}`
      })
    })

    let clsok2 = await cli2.connect("127.0.0.1", 1223)

    clsok2.write("hi")

    await sleep(200)
    assert(tunData2 === "hi", `Wrong tunData = ${tunData2}`)


    clsok2.close()

    // await sleep(2000)
    console.log("\n\n\n\n")

    clsok2 = await cli2.connect("127.0.0.1", 1223)
    // await sleep(2000)
    clsok2.write("hi2")

    await sleep(200)
    assert(tunData2 === "hi2", `Wrong tunData = ${tunData2}`)
    clsok2.close()
    sser2.close()

    clsok.close()
    sser.close()
    await sleep(200)

    await this.appDevice1.closeTcpTunnel(tunnelId)
    if (tunnelId2) {
      await this.appDevice1.closeTcpTunnel(tunnelId2)
    }

    await this.appDevice1.relayDisconnect()
    await this.appDevice2.relayDisconnect()
  }

  async test_shutdown(testId){
    await this.appAdmin.shutdown()
    await this.appDevice1.shutdown()
    await this.appDevice2.shutdown()
  }
}



async function main() {
  const fmnetTest = new FMnetTest()
  await fmnetTest.init()
  const tests = Object.getOwnPropertyNames(FMnetTest.prototype)
    .filter(t => t.startsWith("test_"))
  //.sort((a,b) => Number(a.split("_")[1]) - Number(b.split("_")[1]))

  for (const t of tests) {
    console.log(`Running ${t}`)
    await fmnetTest[t](t)
    console.log(`${t} ... OK`)
    console.log("--------------- 😎")
  }
}

main()

