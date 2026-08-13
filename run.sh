#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REST_ENDPOINT="${1:-}"
TARGET="cli"

if [ "$REST_ENDPOINT" = "local" ]; then
  export FMNET_REST_ENDPOINT="http://localhost:8787"
  echo "Rest endpoint is $FMNET_REST_ENDPOINT"
else
  unset FMNET_REST_ENDPOINT
fi


case "$TARGET" in
  cli)
    cd "$ROOT_DIR/apps/fmnet/src/cli" && node --experimental-websocket src/index.js
    ;;
  mobile|react-native)
    exit 1
    ;;
  *)
    exit 1
    ;;
esac