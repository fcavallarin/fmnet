#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# TARGET="${1:-}"
TARGET="cli"

# if [ "$TARGET" = "" ]; then
#   echo "Usage: $0 <cli|mobile>"
#   exit 1
# fi

case "$TARGET" in
  cli)
    cd "$ROOT_DIR/apps/fmnet/src/cli" && node src/index.js
    ;;
  mobile|react-native)
    exit 1
    ;;
  *)
    exit 1
    ;;
esac