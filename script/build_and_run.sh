#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-web}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

show_usage() {
  cat <<'USAGE'
usage: ./script/build_and_run.sh [mode]

Modes:
  start, run, web       Start the Volt web dev server
  extension             Start the Chrome extension dev server
  ios, mobile           Build, install, and launch the iOS app on a simulator
  build-web             Build the web app
  build-extension       Build the Chrome extension
  build-ios             Compile the iOS app for a generic simulator
  test                  Run the repo test suite
  repo-health           Run repository health checks
  help, --help          Show this help
USAGE
}

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    exec pnpm "$@"
  fi

  exec corepack pnpm "$@"
}

case "$MODE" in
  start|run|web)
    run_pnpm dev:web
    ;;
  extension)
    run_pnpm dev:extension
    ;;
  ios|mobile)
    run_pnpm dev:mobile
    ;;
  build-web)
    run_pnpm build:web
    ;;
  build-extension)
    run_pnpm build:extension
    ;;
  build-ios)
    run_pnpm build:mobile
    ;;
  test)
    run_pnpm test
    ;;
  repo-health)
    run_pnpm check:repo-health
    ;;
  help|--help)
    show_usage
    ;;
  *)
    show_usage >&2
    exit 2
    ;;
esac
