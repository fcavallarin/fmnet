#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { SeptClient } from '@sept/client';
import Database from 'better-sqlite3';

import { readFileSync, writeFileSync } from 'node:fs';
import { deserializeBin, serializeBin } from '@sept/core';
import { randomBytes } from 'node:crypto';

export function readJsonFile(path) {
  return JSON.parse(
    readFileSync(path, 'utf8')
  );
}


export function writeJsonFile(path, content) {
  return writeFileSync(
    path,
    JSON.stringify(content)
  )
}


function openDb(dbPath) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');

  return db;
}



export class BaseSeptApp {
  constructor(clientName) {
    this.clientName = clientName;
  }

  async init() {
    const fmDbPath = path.resolve(`./data/fm-${this.clientName}.db`);

    this.septClient = await SeptClient.create({
      secretKeyProvider: async () => deserializeBin(`oZDipiLZnJq-SAR2Qwde7D-fkWmM3OaLi9N18WubdOU`),
      dataStore: {
        type: "better-sqlite",
        open: () => openDb(fmDbPath),
        close: (store) => store.close(),
        clearDb: true // for debugging/dev
      },

    })


    // this.septClient.on("export.device", async deviceData => {
    //   writeJsonFile(`./data/cl-${this.clientName}.json`, deviceData)
    // })

    // this.septClient.on("policy.update", async deviceData => {
    //   const deviceId = await this.septClient.getDeviceId()
    //   if (deviceData.srcDeviceId === deviceId) {
    //     await this.identityStore.set(deviceData.dstDeviceId, deviceData.metadata.dstName)
    //   }

    //   if (deviceData.dstDeviceId === deviceId) {
    //     await this.identityStore.set(deviceData.srcDeviceId, deviceData.metadata.srcName)
    //   }
    // })

    this.septClient.register(
      "message", (actionData) => {
        console.log(`---RECV---`)
        console.log(actionData)
        console.log(`----------`)
      }
    )
  }
  static async create(clientName) {
    const i = new this(clientName);
    await i.init()
    return i;

  }


  async bootstrap() {
    return await this.septClient.bootstrap()

  };

  async sendEvent(type, message, dstDeviceIds) {
    return await this.septClient.sendEvent(type, message, dstDeviceIds)

  };


  async addDevice(deviceData, metadata, onPaired, onPairingTimeout) {
    // const deviceData = readJsonFile(`./data/cl-${clientName}.json`)
    // console.log(deviceData)
    return await this.septClient.addDevice(
      deviceData, metadata, onPaired, onPairingTimeout
    )
  };


  async initDevice() {
    return await this.septClient.initDevice();
  };

  async getPairing(pin) {
    await this.septClient.getPairing(pin)
  };


  async sync() {
    return await this.septClient.sync()
  };

  async relayConnect() {
    return await this.septClient.relayConnect()
  };

  async relayDisconnect() {
    return await this.septClient.relayDisconnect()
  };


  async updatePolicy(srcDeviceId, dstDeviceId, policy) {
    return await this.septClient.updatePolicy(
      srcDeviceId,
      dstDeviceId,
      policy,
      {}
    )
  };

  async getDeviceGraph() {
    return await this.septClient.getDeviceGraph()
  }

  async getDeviceId() {
    return await this.septClient.getDeviceId()
  }

  async getStoredActions(filters) {
    return await this.septClient.getStoredActions(filters)
  }

  async grant(srcDeviceId, dstDeviceId, action, metadata) {
    return await this.septClient.grant(srcDeviceId, dstDeviceId, action, metadata)
  }

  async revoke(srcDeviceId, dstDeviceId, action, metadata) {
    return await this.septClient.revoke(srcDeviceId, dstDeviceId, action, metadata)
  }

  async getPolicy(srcDeviceId, dstDeviceId) {
    return await this.septClient.getPolicy(srcDeviceId, dstDeviceId)
  }

  async grantAdmin(deviceId) {
    return await this.septClient.grantAdmin(deviceId)
  }

  async revokeAdmin(deviceId) {
    return await this.septClient.revokeAdmin(deviceId)
  }

  async getDeviceData() {
    return await this.septClient.getDeviceData()
  }
}
