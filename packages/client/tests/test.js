import { canonicalJson } from "@sept/core";
import { BaseSeptApp } from "./base_app.js";

const NUM_DEVICES = 4

function assert(cond, err) {
  if (!cond) {
    throw new Error(err)
  }
}

async function sleep(ms) {
  await new Promise(r => setTimeout(r, ms))
}

class SeptTest {
  async init() {
    this.appAdmin = await BaseSeptApp.create("admin")
    for (let i = 1; i <= NUM_DEVICES; i++) {
      this[`appDevice${i}`] = await BaseSeptApp.create(`device${i}`)
    }
  }

  async _sync_client_devices(exclude = []) {
    for (let i = 1; i <= NUM_DEVICES; i++) {
      await this[`appDevice${i}`].sync()
    }
  }

  async test_bootstrap_and_add_devices(testId) {
    await this.appAdmin.bootstrap()
    console.log(`Bootstrap done`)

    for (let i = 1; i <= NUM_DEVICES; i++) {
      let dPaired
      const dP = new Promise(resolve => dPaired = resolve)
      const deviceData = await this[`appDevice${i}`].initDevice()
      console.log(`Init device${i} done`)
      const pin = await this.appAdmin.addDevice(deviceData, {}, dPaired)
      console.log(`Device${i} added`)
      await this[`appDevice${i}`].getPairing(pin)
      await this[`appDevice${i}`].sync()
      await dP
      console.log(`Device ${i} paired`)
    }


    const aDevices = await this.appAdmin.septClient.getDevices();
    assert(aDevices.length == NUM_DEVICES + 1, `aDevices len = ${aDevices.length}`)

    this.appAdminDeviceId = await this.appAdmin.getDeviceId()
    for (let i = 1; i <= NUM_DEVICES; i++) {
      this[`appDevice${i}DeviceId`] = await this[`appDevice${i}`].getDeviceId()
    }

    await this.appAdmin.grant(
      this.appDevice1DeviceId,
      this.appDevice2DeviceId,
      ["message"]
    );
    console.log(`Policy updated`)


    await this._sync_client_devices()
    console.log(`All Devices sync done`)


    const d1Graph = await this.appDevice1.getDeviceGraph();
    assert(d1Graph.length == 1, `d1Graph len = ${d1Graph.length}`)
    assert(d1Graph[0].srcDeviceId == this.appDevice1DeviceId, `d1Graph[0].srcDeviceId = ${d1Graph[0].srcDeviceId}`)
    assert(d1Graph[0].dstDeviceId == this.appDevice2DeviceId, `d1Graph[0].dstDeviceId = ${d1Graph[0].dstDeviceId}`)
    assert(d1Graph[0].policy.allowedActions[0] == "message", `d1Graph[0].policy = ${JSON.stringify(d1Graph[0].policy)}`)

    const d2Graph = await this.appDevice2.getDeviceGraph();
    assert(d2Graph.length == 1, `d2Graph len = ${d2Graph.length}`)
    assert(d2Graph[0].srcDeviceId == this.appDevice1DeviceId, `d2Graph[0].srcDeviceId = ${d2Graph[0].srcDeviceId}`)
    assert(d2Graph[0].dstDeviceId == this.appDevice2DeviceId, `d2Graph[0].dstDeviceId = ${d2Graph[0].dstDeviceId}`)
    assert(d2Graph[0].policy.allowedActions[0] == "message", `d2Graph[0].policy = ${JSON.stringify(d2Graph[0].policy)}`)

    await this.appDevice2.relayDisconnect()

  }

  async test_websocket(testId) {
    let connectionOpen = false
    this.appDevice1.septClient.on("connection.open", event => {
      connectionOpen = true
    })
    this.appDevice1.septClient.on("connection.close", event => {
      connectionOpen = false
    })
    await this.appDevice1.relayConnect()
    await sleep(500)
    assert(connectionOpen, "WS connection failed")
    await this.appDevice1.relayDisconnect()
    await sleep(500)
    assert(!connectionOpen, "WS connection close failed")
  }

  async test_send_messages(testId) {
    await this.appAdmin.sendEvent("message", "test1", [this.appDevice1DeviceId])
    console.log(`Message sent admin -> device1`)
    await this.appDevice1.sync()
    console.log(`Device 1 sync done`)

    await this.appDevice1.sendEvent("message", "test2", [this.appDevice2DeviceId])
    console.log(`Message sent device1 -> device2`)
    await this.appDevice2.sync()
    console.log(`Device 2 sync done`)
  }

  async test_policy_device2_to_device1(testId) {

    await this.appAdmin.updatePolicy(
      this.appDevice2DeviceId,
      this.appDevice1DeviceId,
      []
    );
    console.log(`Policy updated`)

    await this.appDevice1.sync()
    console.log(`Device 1 sync done`)
    await this.appDevice2.sync()
    console.log(`Device 2 sync done`)

    const d1Graph = await this.appDevice1.getDeviceGraph();
    assert(d1Graph.length == 2, `d1Graph len = ${d1Graph.length}`)
    assert(d1Graph[1].srcDeviceId == this.appDevice2DeviceId, `d1Graph[1].srcDeviceId = ${d1Graph[1].srcDeviceId}`)
    assert(d1Graph[1].dstDeviceId == this.appDevice1DeviceId, `d1Graph[1].dstDeviceId = ${d1Graph[1].dstDeviceId}`)

    const d2Graph = await this.appDevice2.getDeviceGraph();
    assert(d2Graph.length == 2, `d2Graph len = ${d2Graph.length}`)
    assert(d2Graph[1].srcDeviceId == this.appDevice2DeviceId, `d2Graph[1].srcDeviceId = ${d2Graph[1].srcDeviceId}`)
    assert(d2Graph[1].dstDeviceId == this.appDevice1DeviceId, `d2Graph[1].dstDeviceId = ${d2Graph[1].dstDeviceId}`)

  }


  async test_policy_deny(testId) {

    await this.appAdmin.revoke(
      this.appDevice2DeviceId,
      this.appDevice1DeviceId,
      ["message"]
    );
    console.log(`Policy updated`)

    await this.appDevice1.sync()
    console.log(`Device 1 sync done`)
    await this.appDevice2.sync()
    console.log(`Device 2 sync done`)
    let empty_rcpt_list = false
    try {
      console.log("> Ignore message below:")
      await this.appDevice2.sendEvent("message", testId, [this.appDevice1DeviceId])
    } catch {
      empty_rcpt_list = true
    }

    assert(empty_rcpt_list, "empty_rcpt_list")

    await this.appDevice1.sync()
    await this.appDevice2.sync()

    for (const act of await this.appDevice1.getStoredActions()) {
      assert(act.payload !== testId, `${act.payload}`)
    }

    for (const act of await this.appDevice2.getStoredActions()) {
      assert(act.payload !== testId, `${act.payload}`)
    }

    // Bypass local policy check
    await this.appDevice2.septClient.store.deviceGraphEdge.setPolicy(
      this.appDevice2DeviceId,
      this.appDevice1DeviceId,
      { allowedActions: ["message"] }
    );

    await this.appDevice2.sendEvent("message", testId, [this.appDevice1DeviceId])

    console.log("> Ignore message below:")
    await this.appDevice1.sync()
    await this.appDevice2.sync()

    for (const act of await this.appDevice1.getStoredActions()) {
      assert(act.payload !== testId, `After bypass ${act.payload}`)
    }
    let found = false;
    for (const act of await this.appDevice2.getStoredActions()) {
      if (act.payload === testId) {
        found = true;
        break
      }
    }
    assert(found, "After bypass sender device did not create local event")
  }


  async test_non_admin_policy_update(testId) {
    try {
      await this.appDevice1.grant(
        this.appDevice2DeviceId,
        this.appDevice1DeviceId,
        ["message"]
      );
    } catch {
      return
    }
    assert(false, "Non admin updated policy")
  }

  async test_admin_policy(testId) {
    await this.appAdmin.grant(
      this.appDevice1DeviceId,
      this.appAdminDeviceId,
      ["message"]
    );
    console.log(`Policy updated`)

    await this.appDevice1.sync()

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

    console.log(`Policy check OK `)
  }

  async test_send_message_to_myself(testId) {
    await this.appAdmin.grant(
      this.appDevice1DeviceId,
      this.appDevice1DeviceId,
      ["message"]
    );
    await this.appDevice1.sync()
    await this.appDevice1.sendEvent("message", testId, [this.appDevice1DeviceId])
    console.log(`Message sent device1 -> device1`)
    await this.appDevice1.sync()
    console.log(`Device 1 sync done`)
    const storedMessages = await this.appDevice1.getStoredActions()
    const mess = storedMessages.find(m => m.payload === testId)
    assert(mess, `Message not found: ${JSON.stringify(storedMessages)}`)
    assert(mess?.isIncoming && mess?.isOutgoing, `Message should be both Incoming and Outgoing: ${mess?.isIncoming} ${mess?.isOutgoing}`)
  }

  async test_filter_events(testId) {
    let r
    r = await this.appAdmin.getStoredActions({
      type: "message",
      isOutgoing: true,
      device: { role__ne: "admin" },
    })
    assert(r.length > 0, "Failed to filter messages 1")

    r = await this.appAdmin.getStoredActions({
      type: "message",
      type__isnot: null,
      isOutgoing: true,
      device: { role__in: ["user"] },
      recipient: { deviceId__ne: "xxx" },
      sequence__gt: 1
    })
    assert(r.length > 0, "Failed to filter messages 2")
    assert(r[0].sequence > 1, "Failed to filter messages 3")

    r = await this.appAdmin.getStoredActions({
      type: "message",
      isOutgoing: true,
      device: { role__ne: "admin" },
      recipient: { deviceId__notin: ["xxx", "yyy"] },
      sequence__gt: 1
    })
    assert(r.length > 0, "Failed to filter messages 2")

    let failed

    failed = false
    try {
      await this.appAdmin.getStoredActions({
        typeX: "message",
      })
    } catch {
      failed = true
    }
    assert(failed, "Event filter didn't throw error on wrong field name")

    failed = false
    try {
      await this.appAdmin.getStoredActions({
        type__X: "message",
      })
    } catch {
      failed = true
    }
    assert(failed, "Event filter didn't throw error on wrong operator")
  }

  async test_admin_grant(testId) {

    await this.appAdmin.grant(
      this.appDevice2DeviceId,
      this.appDevice3DeviceId,
      ["message"]
    );
    await this._sync_client_devices()

    let d1Graph = await this.appDevice1.septClient.getDeviceGraph()
    let aGraph = await this.appAdmin.septClient.getDeviceGraph()
    assert(
      canonicalJson(d1Graph) !== canonicalJson(aGraph),
      "Device graph is the same between admin and Device1, this test may be incompete"
    )

    await this.appAdmin.grantAdmin(this.appDevice1DeviceId)
    await this._sync_client_devices()

    d1Graph = (await this.appDevice1.septClient.getDeviceGraph()).map(p => ({
      srcDeviceId: p.srcDeviceId,
      dstDeviceId: p.dstDeviceId,
      policy: p.policy
    }))
    aGraph = (await this.appAdmin.septClient.getDeviceGraph()).map(p => ({
      srcDeviceId: p.srcDeviceId,
      dstDeviceId: p.dstDeviceId,
      policy: p.policy
    }))

    assert(
      canonicalJson(d1Graph) === canonicalJson(aGraph),
      `Device graph differes between admins: ${JSON.stringify(d1Graph, null, 2)} !== ${JSON.stringify(aGraph, null, 2)}`
    )
    const d1Devices = await this.appDevice1.septClient.store.device.getAll()
    for (let i = 2; i <= NUM_DEVICES; i++) {
      assert(
        d1Devices.map(d => d.id).includes(this[`appDevice${i}DeviceId`]),
        `Missing Device${i} from Device1 list (Device1 is now admin)`
      )
    }

    const d4Devices = await this.appDevice4.septClient.getDevices()
    assert(
      d4Devices.map(d => d.id).includes(this.appDevice1DeviceId),
      "Missing Device1 from Device4"
    )

    let d1Data = await this.appDevice1.getDeviceData()
    assert(d1Data.isAdmin, "Device1 should be admin")

    let d1DataOfD2 = await this.appDevice2.septClient.store.device.get(this.appDevice1DeviceId)
    assert(d1DataOfD2.role === "admin", "Device1 should be admin on Device2")

    const d1DataOfAdmin = await this.appAdmin.septClient.store.device.get(this.appDevice1DeviceId)
    assert(d1DataOfAdmin.role === "admin", "Device1 should be admin on Admin")


    let adminMessages
    await this.appDevice2.sync()
    try {
      console.log("> Ignore message below:")
      await this.appDevice2.sendEvent("message", `${testId}-1`, [this.appAdminDeviceId])
    } catch { }
    await this.appAdmin.sync()
    adminMessages = await this.appAdmin.getStoredActions({
      type: "message",
      payload: `${testId}-1`
    })
    assert(adminMessages.length === 0, "Admin got the message from Device2")

    await this.appDevice1.grant(
      this.appDevice2DeviceId,
      this.appAdminDeviceId,
      ["message"]
    )
    await this.appDevice2.sync()
    await this.appAdmin.sync()
    await this.appDevice2.sendEvent("message", `${testId}-1`, [this.appAdminDeviceId])
    await this.appAdmin.sync()
    adminMessages = await this.appAdmin.getStoredActions({
      type: "message",
      payload: `${testId}-1`
    })
    assert(adminMessages.length > 0, "Admin did not get the message from Device2")

    await this.appAdmin.revokeAdmin(this.appDevice1DeviceId)

    await this._sync_client_devices()
    d1Data = await this.appDevice1.getDeviceData()
    assert(!d1Data.isAdmin, "Device1 should be NOT admin")
    let failed = false
    try {
      await this.appDevice1.grant(
        this.appDevice2DeviceId,
        this.appAdminDeviceId,
        ["message"]
      )
    } catch {
      failed = true
    }

    assert(failed, "Device1 should not be able to invoke admin actions")

    d1DataOfD2 = await this.appDevice2.septClient.store.device.get(this.appDevice1DeviceId)
    assert(d1DataOfD2.role !== "admin", "Device1 should NOT be admin on Device2")
  }

  async test_app_storage(testId) {
    const st = this.appAdmin.septClient.appStorage("test")
    await st.set("test1", "value 1")
    await st.set("test2", "value 2")
    let keys = await st.keys()
    assert(keys.includes("test1"), `Missing appStore key 'test1, keys are ${JSON.stringify(keys)}`)
    assert(keys.includes("test2"), `Missing appStore key 'test2, keys are ${JSON.stringify(keys)}`)
    assert(await st.get("test1") === "value 1", `Wrong appStore value`)

    await st.delete("test2")
    keys = await st.keys()
    assert(!keys.includes("test2"), `Missing appStore key delete 'test2`)

    await st.set("test1", "value 3")
    assert(await st.get("test1") === "value 3", `Wrong appStore value update`)
  }


  async test_invalidate_device(testId) {
    const devices = await this.appDevice1.septClient.getDevices()
    await this.appAdmin.septClient.invalidateDevice(this.appDevice2DeviceId)
    await this.appDevice1.sync()
    const devices1 = await this.appDevice1.septClient.getDevices()

    assert(devices1.length === devices.length - 1, "Device not invalidated")
    let exception = false
    try {
      await this.appDevice2.sendEvent("message", testId, [this.appDevice1DeviceId])
    } catch {
      exception = true
    }
    assert(exception, "Exception not raised after device invalidation")

    const graph = await this.appDevice1.septClient.getDeviceGraph()
    for (const g of graph) {
      assert(
        g.srcDeviceId !== this.appDevice2DeviceId && g.dstDeviceId !== this.appDevice2DeviceId,
        "Revoked device still in device_graph"
      )
    }

  }

}


async function main() {
  const fmnetTest = new SeptTest()
  await fmnetTest.init()
  const tests = Object.getOwnPropertyNames(SeptTest.prototype)
    .filter(t => t.startsWith("test_"))
  //.sort((a,b) => Number(a.split("_")[1]) - Number(b.split("_")[1]))

  for (const t of tests) {
    console.log(`Running ${t}`)
    await fmnetTest[t](t)
    console.log(`${t} ... OK`)
    console.log("---------------")
  }
}

main()

