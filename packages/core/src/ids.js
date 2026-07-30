import { serializeBin, utf8Encode } from './serialization.js';
import { sha256 } from '../../crypto/src/hash.js';


export function makeId(prefix, hashBytes, length = 32) {
  const encoded = serializeBin(sha256(hashBytes)).slice(0, length);

  if (!prefix) return encoded;

  return `${prefix}_${encoded}`;
}

export function makeIdFromStr(prefix, str, length = 32) {
  const hashBytes = new TextEncoder().encode(str);
  return makeId(prefix, hashBytes, length);
}

export function normalizeId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function assertId(value, label = 'id') {
  const normalized = normalizeId(value);

  if (!normalized) {
    throw new Error(`Invalid ${label}`);
  }

  return normalized;
}

export function bytesForIdSeed(...parts) {
  return utf8Encode(parts.map(String).join('\x1f'));
}
