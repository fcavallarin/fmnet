import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";


export function encryptSymmetric(key, plaintext) {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error("key must be 32 bytes!");
  }

  const nonce = randomBytes(24);

  const input = plaintext instanceof Uint8Array
    ? plaintext
    : new TextEncoder().encode(String(plaintext));

  const cipher = xchacha20poly1305(key, nonce);
  const encrypted = cipher.encrypt(input);

  return {
    encrypted,
    nonce
  }
}


export function decryptSymmetric(key, nonce, encrypted) {
  const cipher = xchacha20poly1305(key, nonce);
  const decrypted = cipher.decrypt(encrypted);
  return decrypted;
}


export function encryptWithPayloadKey(payloadKey, plaintext) {
  const {encrypted, nonce} = encryptSymmetric(payloadKey, plaintext)
  const out = new Uint8Array(nonce.length + encrypted.length);
  out.set(nonce, 0);
  out.set(encrypted, nonce.length);

  return out;
}

export function decryptWithPayloadKey(payloadKey, ciphertext) {
  if (!(ciphertext instanceof Uint8Array) || ciphertext.length < 24 + 16) {
    throw new Error("Invalid ciphertext");
  }

  const nonce = ciphertext.slice(0, 24);
  const encrypted = ciphertext.slice(24);

  return decryptSymmetric(payloadKey, nonce, encrypted)
}

