# Technical Plan: Transforming Scout Extension

## Overview

This document outlines the plan to transform the extension into Scout, focusing on:

1. Keeping only the context menu action and CMDK popup
2. Removing the toolbar functionality
3. Adding a new sidepanel feature with controller testing tool

## Current State Analysis

The current Scout extension includes:

- Content script with toolbar injection
- CMDK popup functionality
- Context menu actions
- Sidepanel support
- Background service worker with extensive functionality

## Proposed Changes

### 1. Remove Toolbar Functionality

**Files to modify:**

- `entrypoints/content.ts` - Remove toolbar injection code
- `entrypoints/toolbar-mount.tsx` - Remove this file entirely
- `src/components/toolbar/Toolbar.tsx` - Remove this file entirely
- `src/lib/tools.ts` - Remove or simplify toolbar tools configuration
- `wxt.config.ts` - Remove toolbar-mount from content scripts

**Specific changes:**

- Remove all toolbar-related code from `content.ts` (lines 188-453)
- Remove toolbar-mount entrypoint from `wxt.config.ts` contentScripts
- Delete `toolbar-mount.tsx` and `Toolbar.tsx` files
- Remove toolbar toggle command from background script
- Remove toolbar-related permissions if any

### 2. Keep CMDK Popup Functionality

**Files to retain:**

- `entrypoints/popup/CMDKPopup.tsx` - Keep as is
- `src/components/cmdk-palette/` - Keep all CMDK components
- CMDK-related commands in background script

**No changes needed** - CMDK functionality should remain intact

### 3. Keep Context Menu Actions

**Files to retain:**

- Context menu creation in `background.ts` (lines 125-168)
- Context menu click handlers

**No changes needed** - Context menu functionality should remain intact

### 4. Enhance Sidepanel with Controller Testing

**Files to modify:**

- `entrypoints/sidepanel/main.ts` - Update to support controller testing
- Create new sidepanel component for controller testing

**New implementation:**

- Copy controller testing code from previous implementation
- Adapt it for sidepanel use
- Update sidepanel to show controller testing by default or as a primary feature

### 5. Update Configuration

**Files to modify:**

- `wxt.config.ts` - Remove toolbar-related configurations
- Update manifest permissions if needed

## Implementation Steps

### Step 1: Remove Toolbar Components

1. Delete `entrypoints/toolbar-mount.tsx`
2. Delete `src/components/toolbar/Toolbar.tsx`
3. Remove toolbar-mount from contentScripts in `wxt.config.ts`

### Step 2: Clean Up Content Script

1. Remove toolbar injection code from `entrypoints/content.ts`
2. Remove toolbar-related event listeners
3. Remove toolbar-related message handlers

### Step 3: Update Background Script

1. Remove toolbar toggle command handler
2. Remove toolbar-related message handlers
3. Keep CMDK and context menu functionality intact

### Step 4: Enhance Sidepanel

1. Create new controller testing component for sidepanel
2. Update `entrypoints/sidepanel/main.ts` to support controller testing
3. Copy and adapt controller testing code from previous implementation

### Step 5: Update Configuration

1. Remove toolbar-related configurations from `wxt.config.ts`
2. Update manifest if needed
3. Test all functionality

## File Structure After Changes

```
scout/
├── entrypoints/
│   ├── background.ts (modified)
│   ├── content.ts (modified)
│   ├── options/
│   ├── popup/
│   │   ├── CMDKPopup.tsx (unchanged)
│   │   └── ...
│   └── sidepanel/
│       └── main.ts (enhanced)
├── src/
│   ├── components/
│   │   ├── cmdk-palette/ (unchanged)
│   │   └── ui/ (unchanged)
│   └── lib/
│       ├── tools.ts (simplified)
│       └── ...
└── wxt.config.ts (modified)
```

## Testing Checklist

- [ ] CMDK popup opens and functions correctly
- [ ] Context menu actions work as expected
- [ ] Sidepanel opens with controller testing
- [ ] Controller testing functionality works in sidepanel
- [ ] No toolbar appears on any page
- [ ] Extension loads without errors
- [ ] All keyboard shortcuts work (except toolbar toggle)

## Benefits of This Approach

1. Simplified codebase with fewer components
2. Focused functionality on core features
3. Reduced memory footprint without toolbar
4. Better integration of controller testing in sidepanel
5. Maintains useful features (CMDK, context menu)

## Potential Risks

1. Removing toolbar might break some dependencies
2. Controller testing might need adaptation for sidepanel environment
3. Some users might miss the toolbar functionality

## Timeline Estimate

- Step 1-2: 2 hours (Removing toolbar components)
- Step 3: 1 hour (Background script cleanup)
- Step 4: 3 hours (Sidepanel enhancement)
- Step 5: 1 hour (Configuration updates)
- Testing: 2 hours

**Total estimated time: 9 hours**
