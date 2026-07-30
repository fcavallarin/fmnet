// import * as ed25519 from '@noble/curves/ed25519';
import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';

export async function generateSigningKeyPair() {
  const privateKey = randomBytes(32) //ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export async function sign(privateKey, data) {
  return await ed25519.sign(data, privateKey);
}

export async function verify(publicKey, signature, data) {
  if(!publicKey || !signature){
   return false
  }
  return await ed25519.verify(signature, data, publicKey);
}


export async function signString(privateKey, str) {
  const data = new TextEncoder().encode(str);
  return await ed25519.sign(data, privateKey);
}

export async function verifyString(publicKey, signature, str) {
  const data = new TextEncoder().encode(str);
  return await verify(publicKey, signature, data);
}
