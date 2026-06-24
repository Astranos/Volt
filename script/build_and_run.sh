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
  ios-device            Build, install, and launch the iOS app on Juan's iPhone
  ios-appclip           Build, install, and launch the App Clip on a simulator
  ios-appclip-device    Build, install, and launch the App Clip on Juan's iPhone
  build-web             Build the web app
  build-extension       Build the Chrome extension
  build-ios             Compile the iOS app for a generic simulator
  build-ios-appclip     Compile the App Clip for a generic simulator
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
  ios-device)
    run_pnpm dev:mobile:device
    ;;
  ios-appclip)
    run_pnpm dev:mobile:appclip
    ;;
  ios-appclip-device)
    run_pnpm dev:mobile:appclip:device
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
  build-ios-appclip)
    run_pnpm build:mobile:appclip
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
