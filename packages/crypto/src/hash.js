import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

export function sha256(data) {
  return nobleSha256(data);
}

export function sha256String(str) {
  const data = new TextEncoder().encode(str);
  return sha256(data);
}
