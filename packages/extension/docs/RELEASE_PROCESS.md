# Release Process Guide for AI Models

This document provides step-by-step instructions on how to create release builds for the scout extension. Follow these steps exactly to ensure consistency with previous releases.

## Overview

When creating a new release, you must:

1. Bump version numbers in both configuration files
2. Build the extension
3. Create two zip files with proper naming
4. Place zip files in correct locations
5. Update the releases documentation

## Step-by-Step Process

### Step 1: Bump Version Numbers

Update the version number in **both** files to match (e.g., `1.0.7`):

1. **File: `wxt.config.ts`**

   - Location: Line 21 in the `manifest` object
   - Property: `version: "X.X.X"`
   - Update to new version number

2. **File: `package.json`**
   - Location: Near the top of the file
   - Property: `"version": "X.X.X"`
   - Update to the **same** version number as wxt.config.ts

**Important:** Both files MUST have identical version numbers.

### Step 2: Build the Extension

Run the production build command:

```bash
pnpm build
```

This creates the production build in `.output/scout/` directory.

### Step 3: Create the Packed Zip (for Chrome Web Store)

Create a zip file of the built extension for publishing to the Chrome Web Store.

**Naming Convention:** `scout-v{VERSION}-packed.zip`

**Example:** `scout-v1.0.7-packed.zip`

**Location:** Keep this file in `.output/` directory

**Command:**

```bash
cd .output
zip -r scout-v1.0.7-packed.zip scout
cd ..
```

**What it contains:** The entire `scout/` folder from `.output/`

### Step 4: Create the Unpacked Release Zip (for GitHub Releases)

Create a zip file for users to manually install the extension.

**Naming Convention:** `scout-v{VERSION}.zip`

**Example:** `scout-v1.0.7.zip`

**Location:** Move this file to `releases/` directory

**Command:**

```bash
cd .output
zip -r scout.zip scout
mv scout.zip ../releases/scout-v1.0.7.zip
cd ..
```

**What it contains:** The entire `scout/` folder from `.output/`

**Note:** This is the same content as the packed zip, but with different naming for the releases folder.

### Step 5: Update Releases Documentation

Update the `releases/releases.md` file with the new version information.

**File:** `releases/releases.md`

**Add a new section at the top** with the following structure:

```markdown
## v{VERSION} - {DATE}

### Features

- {List new features added}
- {Another feature}

### Improvements

- {List improvements made}
- {Another improvement}

### Bug Fixes

- {List bugs fixed}
- {Another fix}

### Installation

1. Download [scout-v{VERSION}.zip](./scout-v{VERSION}.zip)
2. Unzip the file
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" (toggle in top right)
5. Click "Load unpacked"
6. Select the unzipped `scout` folder

Note: The packed version for Chrome Web Store submission is located at `.output/scout-v{VERSION}-packed.zip`
```

**Important:**

- Replace `{VERSION}` with the actual version number (e.g., `1.0.7`)
- Replace `{DATE}` with current date (e.g., `2025-01-15`)
- Fill in the features, improvements, and bug fixes based on what changed
- Keep previous versions below the new entry

## File Naming Reference

Based on previous releases, here are the exact naming patterns:

### Packed Zip (in `.output/`)

- `scout-v1.0.0-packed.zip`
- **New:** `scout-v{VERSION}-packed.zip`

### Unpacked Release Zip (in `releases/`)

- `scout-v1.0.0.zip`
- **New:** `scout-v{VERSION}.zip`

## Complete Example Workflow

Here's a complete example for version `1.0.7`:

```bash
# Step 1: Bump versions (edit files manually)
# - wxt.config.ts: version: "1.0.7"
# - package.json: "version": "1.0.7"

# Step 2: Build
pnpm build

# Step 3: Create packed zip (stays in .output/)
cd .output
zip -r scout-v1.0.7-packed.zip scout

# Step 4: Create unpacked release zip (goes to releases/)
zip -r scout.zip scout
mv scout.zip ../releases/scout-v1.0.7.zip
cd ..

# Step 5: Update releases/releases.md
# Add new version section at the top of the file
```

## Verification Checklist

Before considering the release complete, verify:

- [ ] `wxt.config.ts` version matches `package.json` version
- [ ] `pnpm build` completed successfully without errors
- [ ] Packed zip exists: `.output/scout-v{VERSION}-packed.zip`
- [ ] Unpacked zip exists: `releases/scout-v{VERSION}.zip`
- [ ] Both zips contain the `scout/` folder with manifest.json and all extension files
- [ ] `releases/releases.md` has new version section at the top
- [ ] New version section includes: version number, date, features, improvements, fixes, and installation instructions
- [ ] File naming exactly matches the pattern from previous releases

## Common Mistakes to Avoid

1. ❌ **Don't** name files differently (e.g., `scout-1.0.7.zip` instead of `scout-v1.0.7.zip`)
2. ❌ **Don't** forget the "v" prefix in zip file names
3. ❌ **Don't** put the packed zip in `releases/` folder (it belongs in `.output/`)
4. ❌ **Don't** create version mismatch between `wxt.config.ts` and `package.json`
5. ❌ **Don't** forget to update `releases/releases.md`
6. ❌ **Don't** zip the `.output` folder itself - zip the `scout` folder inside it
7. ❌ **Don't** leave the temporary `scout.zip` in `.output/` after moving it

## Quick Command Reference

```bash
# Bump versions first (manual edit)

# Build and create both zips
pnpm build && \
cd .output && \
zip -r scout-v{VERSION}-packed.zip scout && \
zip -r scout.zip scout && \
mv scout.zip ../releases/scout-v{VERSION}.zip && \
cd ..

# Update releases/releases.md (manual edit)
```

Replace `{VERSION}` with actual version number (e.g., `1.0.7`).

## Notes for AI Models

When the user asks to "bump the version and create release files":

1. Ask what the new version number should be (or auto-increment the patch version)
2. Update both `wxt.config.ts` and `package.json` to the same version
3. Run the build command
4. Create both zip files with correct naming
5. Place them in correct locations
6. Update `releases/releases.md` with release notes
7. Confirm completion with a summary of what was done

Always follow this process exactly to maintain consistency across releases.
