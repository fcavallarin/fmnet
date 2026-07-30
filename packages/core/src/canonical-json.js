import { assert } from './utils.js'

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalize(value) {
  if (value === null) return null;

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (isPlainObject(value)) {
    const out = {};
    const keys = Object.keys(value).sort();

    for (const key of keys) {
      const v = value[key];

      if (v === undefined) continue;

      assert(
        typeof v !== 'function' && typeof v !== 'symbol',
        `Unserializable value at key ${key}`
      );

      out[key] = canonicalize(v);
    }

    return out;
  }

  assert(
    typeof value !== 'bigint' &&
    typeof value !== 'function' &&
    typeof value !== 'symbol' &&
    value !== undefined,
    `Unserializable value ${typeof value}`
  );

  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalJsonBytes(value) {
  return new TextEncoder().encode(canonicalJson(value));
}

export function parseCanonicalJson(value) {
  assert(typeof value === 'string', 'Expected string');
  return JSON.parse(value);
}
