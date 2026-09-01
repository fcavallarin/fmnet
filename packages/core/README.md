# `@sept/core`

Small cross-runtime primitives shared by SEPT client/server packages.

Current exports include:

- canonical JSON helpers;
- binary/base64url serialization;
- event serialization;
- deterministic/hash-based ID helpers;
- generic utilities;
- HTTP/request helpers;
- SQL adapters for supported runtimes;
- `EventBus`;
- `AsyncQueue`.

This package is intentionally low-level and does not implement the SEPT application authorization or event lifecycle by itself.
