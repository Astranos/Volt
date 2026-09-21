#!/bin/bash
# Build helper for the Volt Android app (requires Homebrew openjdk@17).
set -euo pipefail
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")"
exec ./gradlew "$@"
