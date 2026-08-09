import { assert } from './utils.js'
import canonicalize from 'canonicalize';


export function canonicalJson(value) {
  return canonicalize(value)
}

export function canonicalJsonBytes(value) {
  return new TextEncoder().encode(canonicalJson(value));
}

export function parseCanonicalJson(value) {
  assert(typeof value === 'string', 'Expected string');
  return JSON.parse(value);
}
