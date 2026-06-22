#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$ROOT_DIR/packages/extension/.output/volt"
MANIFEST_PATH="$EXTENSION_DIR/manifest.json"
BROWSER_CACHE_DIR="$HOME/.cache/volt-browsers"
CHROME_BIN=""

find_chrome_for_testing() {
  local browser_path
  browser_path="$(find \
    "/Applications" \
    "$BROWSER_CACHE_DIR" \
    -path "*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
    -type f \
    -perm -111 \
    2>/dev/null | head -n 1 || true)"
  printf '%s\n' "$browser_path"
}

install_chrome_for_testing() {
  mkdir -p "$BROWSER_CACHE_DIR"
  echo "Chrome 137+ ignores --load-extension in regular Google Chrome."
  echo "Installing Chrome for Testing into: $BROWSER_CACHE_DIR"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm dlx @puppeteer/browsers install chrome@stable --path "$BROWSER_CACHE_DIR"
  else
    corepack pnpm dlx @puppeteer/browsers install chrome@stable --path "$BROWSER_CACHE_DIR"
  fi
}

CHROME_BIN="$(find_chrome_for_testing)"
if [[ -z "$CHROME_BIN" ]]; then
  install_chrome_for_testing
  CHROME_BIN="$(find_chrome_for_testing)"
fi

if [[ -z "$CHROME_BIN" || ! -x "$CHROME_BIN" ]]; then
  echo "Chrome for Testing was not found after install." >&2
  echo "Install it manually, then rerun this action." >&2
  exit 1
fi

worktree_parent="$(basename "$(dirname "$ROOT_DIR")")"
worktree_name="$(basename "$ROOT_DIR")"
profile_dir="$HOME/.chrome-volt-dev/${worktree_name}-${worktree_parent}"
log_dir="$ROOT_DIR/.codex/logs"
log_file="$log_dir/extension-dev.log"
pid_file="$log_dir/extension-dev.pid"

mkdir -p "$log_dir" "$profile_dir"

if [[ -f "$pid_file" ]]; then
  old_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" 2>/dev/null || true
  fi
fi

rm -f "$MANIFEST_PATH"

echo "Starting Volt extension dev server from: $ROOT_DIR"
(
  cd "$ROOT_DIR"
  if command -v pnpm >/dev/null 2>&1; then
    exec env VOLT_MANUAL_CHROME=1 pnpm dev:extension
  fi
  exec env VOLT_MANUAL_CHROME=1 corepack pnpm dev:extension
) >"$log_file" 2>&1 &
dev_pid="$!"
echo "$dev_pid" > "$pid_file"

cleanup() {
  if kill -0 "$dev_pid" 2>/dev/null; then
    kill "$dev_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Waiting for extension manifest: $MANIFEST_PATH"
for _ in {1..120}; do
  if [[ -f "$MANIFEST_PATH" ]]; then
    break
  fi
  if ! kill -0 "$dev_pid" 2>/dev/null; then
    echo "Extension dev server exited before manifest was created. Log:" >&2
    tail -n 80 "$log_file" >&2 || true
    exit 1
  fi
  sleep 0.5
done

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Timed out waiting for extension manifest. Log:" >&2
  tail -n 80 "$log_file" >&2 || true
  exit 1
fi

echo "Opening Chrome for Testing profile: $profile_dir"
echo "Browser: $CHROME_BIN"
echo "Loading extension: $EXTENSION_DIR"
pkill -f "user-data-dir=$profile_dir" 2>/dev/null || true
sleep 0.3

"$CHROME_BIN" \
  --user-data-dir="$profile_dir" \
  --disable-extensions-except="$EXTENSION_DIR" \
  --load-extension="$EXTENSION_DIR" \
  chrome://extensions >/dev/null 2>&1 &

echo "Extension dev server is running. Log: $log_file"
wait "$dev_pid"
