import { sha256String, signString, verifyString, randomBytes } from '@sept/crypto';
import { deserializeBin, serializeBin } from './serialization.js';
import { canonicalJson } from './canonical-json.js';



export class SeptRequest {
  static VERSION = "SEPT-SIGN-V1";

  static async create(input, privateKey) {
    const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
    const nonce = input.nonce ?? serializeBin(randomBytes(32))

    const query = this.normalizeQuery(input.query ?? {});
    const bodyHash = await this.bodyHash(input.body);

    const headers = {
      ...(input.headers ?? {}),
      "x-sept-version": this.VERSION,
      "x-sept-device-id": input.deviceId,
      "x-sept-timestamp": String(timestamp),
      "x-sept-nonce": nonce,
      "x-sept-body-sha256": bodyHash,
    };

    const canonical = this.canonicalRequest({
      method: input.method,
      path: input.path,
      query,
      headers,
      bodyHash,
    });

    const signature = await signString(privateKey, canonical);
    headers["x-sept-signature"] = serializeBin(signature);

    return {
      method: input.method.toUpperCase(),
      path: input.path,
      query,
      headers,
      body: JSON.stringify(input.body),
    };
  }

  static getDeviceId(req) {
    const h = this.lowerHeaders(req.headers);
    return h["x-sept-device-id"];
  }

  static async verify(req, body, publicKey, options = {}) {
    const h = this.lowerHeaders(req.headers);

    for (const name of [
      "x-sept-version",
      "x-sept-device-id",
      "x-sept-timestamp",
      "x-sept-nonce",
      "x-sept-body-sha256",
      "x-sept-signature",
    ]) {
      if (!h[name]) return false;
    }

    if (h["x-sept-version"] !== this.VERSION) return false;

    const expectedBodyHash = await this.bodyHash(body);
    if (h["x-sept-body-sha256"] !== expectedBodyHash) return false;

    const timestamp = Number(h["x-sept-timestamp"]);
    if (!Number.isFinite(timestamp)) return false;

    const maxSkew = options.maxClockSkewSeconds ?? 300;
    const now = Math.floor(Date.now() / 1000);

    if (Math.abs(now - timestamp) > maxSkew) return false;

    if (options.nonceSeen) {
      const alreadySeen = await options.nonceSeen(
        h["x-sept-device-id"],
        h["x-sept-nonce"]
      );

      if (alreadySeen) return false;
    }

    const canonical = this.canonicalRequest({
      method: req.method,
      path: req.path,
      query: this.normalizeQuery(req.query ?? {}),
      headers: h,
      bodyHash: h["x-sept-body-sha256"],
    });

    const signature = deserializeBin(h["x-sept-signature"]);

    return await verifyString(publicKey, signature, canonical);
  }

  static canonicalRequest({ method, path, query, headers, bodyHash }) {
    const h = this.lowerHeaders(headers);

    const signedHeaders = [
      "x-sept-version",
      "x-sept-device-id",
      "x-sept-timestamp",
      "x-sept-nonce",
      "x-sept-body-sha256",
    ];

    const canonicalHeaders = signedHeaders
      .map((name) => `${name}:${this.normalizeHeaderValue(h[name] ?? "")}`)
      .join("\n");

    return [
      this.VERSION,
      method.toUpperCase(),
      this.normalizePath(path),
      this.canonicalQuery(query),
      canonicalHeaders,
      bodyHash,
    ].join("\n");
  }

  static async bodyHash(body) {
    const canonicalBody =
      body === undefined || body === null ? "" : canonicalJson(body);

    return serializeBin(sha256String(canonicalBody))
  }

  static normalizeQuery(query) {
    const out = {};

    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      out[k] = String(v);
    }

    return out;
  }

  static canonicalQuery(query) {
    return Object.keys(query)
      .sort()
      .map(
        (k) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(query[k]).replace(
            /%20/g,
            "+"
          )}`
      )
      .join("&");
  }

  static lowerHeaders(headers) {
    const out = {};

    for (const [k, v] of Object.entries(headers ?? {})) {
      out[k.toLowerCase()] = String(v);
    }

    return out;
  }

  static normalizeHeaderValue(value) {
    return String(value).trim().replace(/\s+/g, " ");
  }

  static normalizePath(path) {
    if(!path){
        return "";
    }
    return path.startsWith("/") ? path : `/${path}`;
  }
}