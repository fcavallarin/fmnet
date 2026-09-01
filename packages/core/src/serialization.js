import { assert } from './utils.js'
import { canonicalJson } from './canonical-json.js';
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

function getBufferFromBytes(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function bytesToBase64(bytes) {
  assert(bytes instanceof Uint8Array, 'Expected Uint8Array');

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(getBufferFromBytes(bytes)).toString('base64');
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

export function base64ToBytes(value) {
  assert(typeof value === 'string', 'Expected string');

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }

  const binary = atob(value);
  const out = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }

  return out;
}

export function base64ToBase64Url(value) {
  assert(typeof value === 'string', 'Expected string');

  return value
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function base64UrlToBase64(value) {
  assert(typeof value === 'string', 'Expected string');
  assert(BASE64URL_RE.test(value), 'Invalid base64url string');

  let out = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = out.length % 4;

  if (pad === 2) out += '==';
  else if (pad === 3) out += '=';
  else if (pad !== 0) {
    throw new Error('Invalid base64url padding');
  }

  return out;
}

export function serializeBin(bytes) {
  return base64ToBase64Url(bytesToBase64(bytes));
}

export function deserializeBin(value) {
  return base64ToBytes(base64UrlToBase64(value));
}

export function utf8Encode(value) {
  assert(typeof value === 'string', 'Expected string');
  return new TextEncoder().encode(value);
}

export function utf8Decode(bytes) {
  assert(bytes instanceof Uint8Array, 'Expected Uint8Array');
  return new TextDecoder().decode(bytes);
}

export function serializeEvent(networkId, eventId, recipients, senderDeviceId, body, ts) {
  return canonicalJson({
    networkId, eventId, recipients, senderDeviceId, body, ts
  })
}