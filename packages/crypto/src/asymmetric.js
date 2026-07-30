import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";


function deriveWrapKey(senderPrivateKey, recipientPublicKey, nonce) {
  const sharedSecret = x25519.getSharedSecret(senderPrivateKey, recipientPublicKey);

  return hkdf(
    sha256,
    sharedSecret,
    nonce,   // salt
    new TextEncoder().encode("fmnet.payload-key.v1"),
    32
  );
}

export function generateEncryptionKeypair() {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);

  return { privateKey, publicKey };
}

export function encryptAsymmetric(senderPrivateKey, recipientPublicKey, payload) {

  const nonce = randomBytes(24);
  const wrapKey = deriveWrapKey(senderPrivateKey, recipientPublicKey, nonce);

  const cipher = xchacha20poly1305(wrapKey, nonce);
  const encryptedPayload = cipher.encrypt(payload);

  const out = new Uint8Array(nonce.length + encryptedPayload.length);
  out.set(nonce, 0);
  out.set(encryptedPayload, nonce.length);

  return out;
}

export function decryptAsymmetric(recipientPrivateKey, senderPublicKey, wrappedPayload) {
  const nonce = wrappedPayload.slice(0, 24);
  const encryptedPayload = wrappedPayload.slice(24);

  const wrapKey = deriveWrapKey(recipientPrivateKey, senderPublicKey, nonce);
  const cipher = xchacha20poly1305(wrapKey, nonce);
  return cipher.decrypt(encryptedPayload);
}


export function encryptPayloadKey(senderPrivateKey, recipientPublicKey, payloadKey) {
  return encryptAsymmetric(
    senderPrivateKey, recipientPublicKey,
    payloadKey
  )
}

export function decryptPayloadKey(
  recipientPrivateKey,
  senderPublicKey,
  wrappedPayloadKey
) {
  return decryptAsymmetric(
    recipientPrivateKey,
    senderPublicKey,
    wrappedPayloadKey
  );
}