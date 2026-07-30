import { SeptRequest } from "@sept/core";
import { deserializeBin } from '@sept/core';


export class RestClient {
  constructor(deviceId, signKey, restEndpoint) {
    this.deviceId = deviceId
    this.signKey = deserializeBin(signKey);
    this.restEndpoint = restEndpoint || "http://localhost:8787";
  }

  async call(path, options = {}) {
    const url = `${this.restEndpoint}/${path}`
    const method = options.method || 'GET';
    const headers = this.parseHeaders(options.header || []);

    const response = await fetch(url, await SeptRequest.create(
      {
        path,
        deviceId: this.deviceId,
        method,
        headers,
        body: options.body || undefined
      },
      this.signKey
    ));

    const body = await response.text();

    if (!response.ok) {
      throw new Error(`REST: ${response.status}`)
    }

    let json;

    try {
      json = JSON.parse(body);
    } catch {
      json = undefined;
    }

    return {
      url,
      method,
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      json
    };
  }

  parseHeaders(items) {
    const headers = {};

    for (const item of items) {
      const index = item.indexOf(':');
      if (index === -1) {
        throw new Error(`Invalid header: ${item}. Use "Name: value".`);
      }

      const name = item.slice(0, index).trim();
      const value = item.slice(index + 1).trim();

      if (!name) {
        throw new Error(`Invalid header: ${item}. Header name is empty.`);
      }

      headers[name] = value;
    }

    return headers;
  }
}
