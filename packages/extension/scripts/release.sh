#!/bin/bash

# Paymore Chrome Extension - Automated Release Script
# This script automates the entire release process as documented in docs/RELEASE_PROCESS.md

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if version argument is provided
if [ -z "$1" ]; then
    print_error "Version number is required!"
    echo "Usage: ./scripts/release.sh <version>"
    echo "Example: ./scripts/release.sh 1.0.9"
    exit 1
fi

NEW_VERSION=$1

# Validate version format (X.X.X)
if ! [[ $NEW_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    print_error "Invalid version format. Use X.X.X (e.g., 1.0.9)"
    exit 1
fi

print_header "Starting Release Process for v$NEW_VERSION"

# Get current directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

print_header "Step 1: Bumping Version Numbers"

# Update wxt.config.ts
echo "Updating wxt.config.ts..."
sed -i.bak "s/version: \"[0-9]\+\.[0-9]\+\.[0-9]\+\"/version: \"$NEW_VERSION\"/" wxt.config.ts
print_success "Updated wxt.config.ts to v$NEW_VERSION"

# Update package.json
echo "Updating package.json..."
sed -i.bak "s/\"version\": \"[0-9]\+\.[0-9]\+\.[0-9]\+\"/\"version\": \"$NEW_VERSION\"/" package.json
print_success "Updated package.json to v$NEW_VERSION"

# Remove backup files
rm -f wxt.config.ts.bak package.json.bak

print_header "Step 2: Building Extension"

echo "Running pnpm build..."
pnpm build

if [ ! -d ".output/paymore-chrome-lite" ]; then
    print_error "Build failed! .output/paymore-chrome-lite directory not found"
    exit 1
fi

print_success "Build completed successfully"

print_header "Step 3: Creating Packed Zip (Chrome Web Store)"

cd .output

# Create packed zip
PACKED_ZIP="paymore-chrome-v${NEW_VERSION}-packed.zip"
echo "Creating $PACKED_ZIP..."
zip -r "$PACKED_ZIP" paymore-chrome-lite > /dev/null 2>&1

if [ ! -f "$PACKED_ZIP" ]; then
    print_error "Failed to create packed zip"
    exit 1
fi

PACKED_SIZE=$(du -h "$PACKED_ZIP" | cut -f1)
print_success "Created $PACKED_ZIP ($PACKED_SIZE)"

print_header "Step 4: Creating Unpacked Release Zip (GitHub Releases)"

# Create temporary zip
TEMP_ZIP="paymore-chrome.zip"
echo "Creating temporary zip..."
zip -r "$TEMP_ZIP" paymore-chrome-lite > /dev/null 2>&1

# Move to releases folder with proper naming
RELEASE_ZIP="paymore-chrome-v${NEW_VERSION}.zip"
mv "$TEMP_ZIP" "../releases/$RELEASE_ZIP"

if [ ! -f "../releases/$RELEASE_ZIP" ]; then
    print_error "Failed to create release zip"
    exit 1
fi

cd ..
RELEASE_SIZE=$(du -h "releases/$RELEASE_ZIP" | cut -f1)
print_success "Created releases/$RELEASE_ZIP ($RELEASE_SIZE)"

print_header "Step 5: Preparing Release Notes"

CURRENT_DATE=$(date +"%B %d, %Y")

print_warning "Release notes template ready. Please update releases/releases.md with:"
echo ""
echo "---"
echo "## v$NEW_VERSION (Current)"
echo ""
echo "**Release Date:** $CURRENT_DATE"
echo "**Download:** [scout-v${NEW_VERSION}.zip](./scout-v${NEW_VERSION}.zip)"
echo ""
echo "**What's New:**"
echo ""
echo "### Features"
echo ""
echo "- [Add new features here]"
echo ""
echo "### Improvements"
echo ""
echo "- [Add improvements here]"
echo ""
echo "### Bug Fixes"
echo ""
echo "- [Add bug fixes here]"
echo ""
echo "### Installation"
echo ""
echo "1. Download [scout-v${NEW_VERSION}.zip](./scout-v${NEW_VERSION}.zip)"
echo "2. Unzip the file"
echo "3. Open Chrome and navigate to \`chrome://extensions/\`"
echo "4. Enable \"Developer mode\" (toggle in top right)"
echo "5. Click \"Load unpacked\""
echo "6. Select the unzipped \`scout\` folder"
echo ""
echo "Note: The packed version for Chrome Web Store submission is located at \`.output/scout-v${NEW_VERSION}-packed.zip\`"
echo "---"
echo ""

print_header "Verification Checklist"

echo "Verifying release files..."
echo ""

# Check version consistency
WXT_VERSION=$(grep -o 'version: "[^"]*"' wxt.config.ts | cut -d'"' -f2)
PKG_VERSION=$(grep -o '"version": "[^"]*"' package.json | head -1 | cut -d'"' -f4)

if [ "$WXT_VERSION" == "$NEW_VERSION" ] && [ "$PKG_VERSION" == "$NEW_VERSION" ]; then
    print_success "Version numbers match in wxt.config.ts and package.json"
else
    print_error "Version mismatch detected!"
    exit 1
fi

if [ -f ".output/$PACKED_ZIP" ]; then
    print_success "Packed zip exists: .output/$PACKED_ZIP"
else
    print_error "Packed zip not found!"
    exit 1
fi

if [ -f "releases/$RELEASE_ZIP" ]; then
    print_success "Release zip exists: releases/$RELEASE_ZIP"
else
    print_error "Release zip not found!"
    exit 1
fi

# Check if manifest.json exists in build
if [ -f ".output/scout/manifest.json" ]; then
    MANIFEST_VERSION=$(grep -o '"version": "[^"]*"' .output/scout/manifest.json | cut -d'"' -f4)
    if [ "$MANIFEST_VERSION" == "$NEW_VERSION" ]; then
        print_success "Manifest version matches: v$MANIFEST_VERSION"
    else
        print_error "Manifest version mismatch! Expected $NEW_VERSION, got $MANIFEST_VERSION"
        exit 1
    fi
else
    print_error "manifest.json not found in build!"
    exit 1
fi

print_header "Release v$NEW_VERSION Complete! 🎉"

echo "Files created:"
echo "  • .output/$PACKED_ZIP ($PACKED_SIZE)"
echo "  • releases/$RELEASE_ZIP ($RELEASE_SIZE)"
echo ""
echo "Next steps:"
echo "  1. Update releases/releases.md with release notes (template printed above)"
echo "  2. Upload $PACKED_ZIP to Chrome Web Store"
echo "  3. Commit and push changes to Git"
echo ""
echo "Git commands:"
echo "  git add wxt.config.ts package.json releases/$RELEASE_ZIP releases/releases.md"
echo "  git commit -m \"Release v$NEW_VERSION\""
echo "  git tag v$NEW_VERSION"
echo "  git push origin main --tags"
