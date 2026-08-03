#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-}"

if [ "$TARGET" = "" ]; then
  echo "Usage: $0 <cli|mobile>"
  exit 1
fi

cd $ROOT_DIR && npm install

case "$TARGET" in
  cli|node)
    cd "$ROOT_DIR/apps/fmnet/src/adapters/node" && npm install
    ;;
  mobile|react-native)
    cd "$ROOT_DIR/apps/fmnet/src/mobile" && npm install
    ;;
  *)
    exit 1
    ;;
esac