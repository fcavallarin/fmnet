# `@sept/crypto`

Cryptographic primitives used by SEPT.

Current implementation:

- Ed25519 signing and verification;
- X25519 key agreement;
- HKDF-SHA256 key derivation for asymmetric payload-key wrapping;
- XChaCha20-Poly1305 authenticated encryption;
- SHA-256;
- secure random values.

The implementation uses Noble JavaScript cryptography packages and is designed to remain portable across the JavaScript runtimes targeted by SEPT.

Protocol-level usage and trust assumptions are documented in:

- [`docs/protocol.md`](../../docs/protocol.md)
- [`docs/security.md`](../../docs/security.md)
