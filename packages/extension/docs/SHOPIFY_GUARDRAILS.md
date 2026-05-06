# Shopify Guardrails Technical Documentation

## Overview

The Shopify Guardrails content script monitors Shopify product admin pages to ensure data integrity and completeness. It provides real-time validation and visual feedback for:

1. **Condition Matching**: Ensures the eBay condition ID matches the Shopify condition
2. **Google Shopping Fields**: Alerts when required Google Shopping metafields are empty

## Architecture

### File Structure

```
entrypoints/shopify-guardrails.ts          # Main content script
src/utils/condition-mapping.ts             # Condition mapping logic
examples/shopify.html                      # Example HTML for testing
```

### Key Components

1. **Field Detectors**: Locate and extract values from Shopify metafields
2. **Condition Validator**: Checks if eBay condition ID matches Shopify condition
3. **Mutation Observer**: Detects changes to metafields in real-time
4. **Notification System**: Displays warnings with dismissible popups
5. **Visual Feedback**: Page border outline (red for errors, orange for warnings)

## How It Works

### 1. Field Detection

The script searches for specific metafield containers in the Shopify admin DOM:

```typescript
// Condition field
const conditionContainer = document.querySelector(
  '[id*="metafields.custom.condition-anchor"]'
);

// eBay Condition field
const ebayConditionContainer = document.querySelector(
  '[id*="metafields.custom.ebay_condition-anchor"]'
);
```

#### Shopify DOM Structure

Shopify uses a nested structure for metafields:

```html
<div id="PRODUCT.metafields.custom.condition-anchor">
  <span class="_ReadField_xxurb_191">
    <div class="_ReadField_123bh_9">
      <!-- Actual text value here -->
      Used
    </div>
  </span>
</div>
```

**Important**: The script uses `querySelectorAll('[class*="_ReadField_"]')` to find all ReadField elements, then iterates to find the first non-placeholder element with a value.

### 2. Condition Matching Logic

Located in `src/utils/condition-mapping.ts`:

#### eBay Condition IDs (Currently Used)

```typescript
const EBAY_CONDITION_MAP = {
  1000: "New",
  1500: "New Other",
  2750: "Like New",        // Video Games Only
  3000: "Used",
  4000: "Very Good",       // Video Games Only
  5000: "Good",            // Video Games Only
  6000: "Acceptable",      // Video Games Only
  7000: "For Parts (not working)",
};
```

#### Shopify to eBay Mapping

The `SHOPIFY_TO_EBAY_MAP` defines which eBay condition IDs are acceptable for each Shopify condition:

```typescript
const SHOPIFY_TO_EBAY_MAP = {
  "New": [1000, 1500, 1750],
  "Used": [2750, 2990, 3000, 3010, 4000, 5000, 6000],
  "For Parts (not working)": [7000],
  // ... more mappings
};
```

#### Matching Algorithm

The `isConditionMatch()` function:

1. Normalizes the Shopify condition (lowercase, trim)
2. Checks for exact matches in the mapping
3. Falls back to partial string matching for complex conditions
4. Returns `true` if the eBay ID is in the acceptable list

```typescript
export function isConditionMatch(
  shopifyCondition: string,
  ebayConditionId: number
): boolean {
  const normalizedShopify = shopifyCondition?.toLowerCase().trim();

  // Check direct mapping
  for (const [shopifyKey, ebayIds] of Object.entries(SHOPIFY_TO_EBAY_MAP)) {
    if (shopifyKey.toLowerCase() === normalizedShopify) {
      return ebayIds.includes(ebayConditionId);
    }
  }

  // Partial match fallbacks...
  return false;
}
```

### 3. Mutation Observer

The script uses a `MutationObserver` to detect changes to metafields in real-time:

```typescript
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    let targetElement = mutation.target;

    // Handle text node changes
    if (targetElement.nodeType === Node.TEXT_NODE) {
      targetElement = targetElement.parentElement;
    }

    // Check if mutation is within a metafield container
    const conditionContainer = targetElement.closest(
      '[id*="metafields.custom.condition-anchor"]'
    );

    if (conditionContainer) {
      // Reset cache and recheck
      conditionField = null;
      conditionMismatchDismissed = false;
      debouncedCheck(150);
    }
  }
});
```

**Observer Configuration**:
- `childList: true` - Watch for DOM changes
- `subtree: true` - Watch all descendants
- `characterData: true` - Watch for text changes
- `characterDataOldValue: true` - Track text value changes

### 4. Notification System

#### Notification Types

1. **Condition Mismatch (Red/Danger)**
   - Shows when eBay condition doesn't match Shopify condition
   - Red page border
   - Dismissible until page refresh or field change

2. **Empty Google Fields (Orange/Warning)**
   - Shows when Google Shopping metafields are empty
   - Orange page border
   - Dismissible until page refresh or field change

#### Dismiss Logic

Each notification type has a dismiss flag:

```typescript
let conditionMismatchDismissed = false;
let googleFieldsWarningDismissed = false;
```

When dismissed:
- The flag is set to `true`
- Notification and border are removed
- Won't reappear until page refresh OR field changes

When fields change:
- The relevant dismiss flag is reset to `false`
- Allows the warning to appear again if still an issue

#### Preventing Flash/Flicker

Notifications check if they already exist with the same data before recreating:

```typescript
const showNotification = (type, data) => {
  if (notifications.has(type)) {
    const existingNotification = notifications.get(type);
    const dataHash = JSON.stringify(data);

    if (existingNotification.dataset.dataHash === dataHash) {
      return; // Same data, don't recreate
    }
  }
  // ... create new notification
};
```

## How to Modify

### Adding New eBay Condition IDs

1. **Update the condition map** (`src/utils/condition-mapping.ts`):

```typescript
export const EBAY_CONDITION_MAP: Record<number, string> = {
  // ... existing conditions
  9999: "New Custom Condition", // Add new condition
};
```

2. **Update the Shopify to eBay mapping**:

```typescript
export const SHOPIFY_TO_EBAY_MAP: Record<string, number[]> = {
  "New": [1000, 1500, 1750, 9999], // Add to appropriate list
};
```

3. **Update the notification display** (`entrypoints/shopify-guardrails.ts:539-548`):

```typescript
const allowedConditions = {
  // ... existing conditions
  9999: "New Custom Condition",
};
```

### Adding Video Game Only Notes

Update the video game condition check in `shopify-guardrails.ts:552-555`:

```typescript
const videoGameNote = ["2750", "4000", "5000", "6000", "9999"].includes(id)
  ? ' <em style="color: #7c2d12;">(Video Games Only)</em>'
  : '';
```

### Monitoring Additional Metafields

To monitor a new metafield (e.g., "Brand"):

1. **Add field detection function**:

```typescript
let brandField = null;

const findBrandField = () => {
  const brandContainer = document.querySelector(
    '[id*="metafields.custom.brand-anchor"]'
  );

  if (brandContainer) {
    const readFields = brandContainer.querySelectorAll('[class*="_ReadField_"]');

    for (const readField of readFields) {
      const className = readField.className || "";
      const isPlaceholder = className.includes("_ReadField--placeholder");
      const value = readField.textContent?.trim() || "";

      if (!isPlaceholder && value) {
        brandField = { element: readField, value: value };
        return true;
      }
    }
  }
  return false;
};
```

2. **Add validation logic**:

```typescript
const checkBrand = () => {
  if (!brandField || !brandField.value) {
    log("Brand field is empty!");
    return false;
  }
  return true;
};
```

3. **Update mutation observer**:

```typescript
const brandContainer = targetElement.closest('[id*="metafields.custom.brand-anchor"]');
if (brandContainer) {
  brandField = null;
  debouncedCheck(150);
}
```

### Changing Check Intervals

The script has multiple check mechanisms:

```typescript
// Initial check delay (after page load)
setTimeout(() => {
  performAllChecks();
}, 1000); // 1 second

// Debounce delay (after mutations detected)
debouncedCheck(150); // 150ms

// Periodic check interval
setInterval(() => {
  performAllChecks();
}, 10000); // 10 seconds

// Retry interval (looking for fields)
const retryInterval = setInterval(() => {
  // ...
}, 2000); // 2 seconds
```

### Customizing Notification Styles

Notification styles are defined in the `STYLES` constant (`shopify-guardrails.ts:31-211`):

```typescript
const STYLES = `
  .scout-notification-danger {
    background-color: #fef2f2;  // Light red background
    border: 2px solid #ef4444;  // Red border
  }

  .scout-notification-warning {
    background-color: #fffbeb;  // Light orange background
    border: 2px solid #f59e0b;  // Orange border
  }
`;
```

### Changing Page Border Colors

Page border variants are defined in `updatePageOutline()`:

```typescript
.scout-outline-danger {
  border-color: #ef4444;  // Red
  animation: scout-outline-pulse-red 2s ease-in-out infinite;
}

.scout-outline-warning {
  border-color: #f59e0b;  // Orange
  animation: scout-outline-pulse-orange 2s ease-in-out infinite;
}
```

## Troubleshooting

### Fields Not Detecting

**Problem**: Script logs show "Container not found" or "No valid field found"

**Solutions**:
1. Check if Shopify changed their DOM structure
2. Inspect the page HTML and verify the `id` attributes
3. Update the selectors in `findConditionField()` and `findEbayConditionField()`
4. Check browser console for detailed logs

### Conditions Not Matching

**Problem**: Valid conditions show as mismatches

**Solutions**:
1. Check the exact Shopify condition text (case-sensitive)
2. Verify the eBay condition ID is a valid number
3. Update `SHOPIFY_TO_EBAY_MAP` with the new condition mapping
4. Check console logs for "Condition check result"

### Notifications Keep Appearing

**Problem**: Dismissed notifications reappear immediately

**Solutions**:
1. Check if mutation observer is triggering too frequently
2. Increase debounce delay in `debouncedCheck()`
3. Verify dismiss flags are not being reset prematurely
4. Check if field cache is being cleared unnecessarily

### Page Border Not Showing

**Problem**: Border outline doesn't appear even with errors

**Solutions**:
1. Check if another extension is conflicting with styles
2. Verify `document.body` exists when creating the outline
3. Check browser console for CSS errors
4. Increase `z-index` in `.scout-page-outline` style

## Testing

### Using Example HTML

The `examples/shopify.html` file contains sample Shopify metafield HTML:

1. Open Chrome DevTools
2. Navigate to a Shopify product page
3. Use "Copy outer HTML" on metafield containers
4. Paste into `examples/shopify.html`
5. Test selectors and validation logic

### Manual Testing Checklist

- [ ] Load a product page with mismatched conditions
- [ ] Verify red border and notification appear
- [ ] Click "Dismiss" button
- [ ] Verify border and notification are removed
- [ ] Change the condition field
- [ ] Verify notification reappears if still mismatched
- [ ] Refresh the page
- [ ] Verify notification reappears
- [ ] Test with empty Google Shopping fields
- [ ] Test with all fields correctly filled
- [ ] Test clicking notification to scroll to field

## Debugging

Enable verbose logging by checking browser console for:

```
[Scout Shopify Guardrails] Initializing Shopify Guardrails
[Scout Shopify Guardrails] Found condition container
[Scout Shopify Guardrails] ✓ Found Condition field: Used
[Scout Shopify Guardrails] ✓ Found eBay Condition field: 3000 ID: 3000
[Scout Shopify Guardrails] === Checking conditions ===
[Scout Shopify Guardrails] ✓ Condition check result: {...}
[Scout Shopify Guardrails] 🔄 Detected Condition field change: childList
```

## Performance Considerations

- **Debouncing**: Prevents excessive checks when multiple mutations occur
- **Caching**: Fields are cached until changes are detected
- **Data hashing**: Prevents notification recreation with same data
- **Selective observation**: Only observes `document.body`, not entire document

## Future Enhancements

Potential improvements to consider:

1. **Persistent Dismissal**: Store dismiss state in `chrome.storage.local`
2. **Customizable Conditions**: Allow users to configure condition mappings
3. **Bulk Edit Support**: Handle multiple products at once
4. **Export Warnings**: Generate CSV of products with issues
5. **Settings Panel**: Add UI for configuration
6. **Slack/Email Notifications**: Alert team of persistent issues
7. **Analytics**: Track most common condition mismatches

## Related Files

- `entrypoints/shopify-guardrails.ts` - Main script (line 19-713)
- `src/utils/condition-mapping.ts` - Condition logic (line 1-137)
- `examples/shopify.html` - Test HTML structure
- `wxt.config.ts` - Build configuration for content script
