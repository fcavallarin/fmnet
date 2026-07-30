import { randomBytes as nobleRandomBytes } from "@noble/hashes/utils.js";

export function randomBytes(length = 32) {
 return nobleRandomBytes(length);
}

export function randomDigits(length) {
    return Array.from(randomBytes(length), b => (b % 10).toString()).join("");
}