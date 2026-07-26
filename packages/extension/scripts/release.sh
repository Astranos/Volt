#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Versions are automatic; do not pass a version."
  echo "Run: pnpm release:extension"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."
exec pnpm release
