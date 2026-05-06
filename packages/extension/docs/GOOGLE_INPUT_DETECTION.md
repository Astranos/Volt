# Google Input Detection in Shopify Condition Checker

## Overview

The Shopify Condition Checker includes functionality to detect EMPTY Google-related input fields in Shopify product admin pages. This feature helps identify when required Google Shopping data is missing, which can be important for maintaining complete product listings and ensuring optimal visibility on Google Shopping.

## How It Works

The detection system uses three complementary strategies to identify Google-related inputs:

### Strategy 1: Metafield Pattern Matching

The system searches for metafield containers with specific ID patterns:

```javascript
const metafieldSelectors = [
  '[id*="metafields.custom.google"]',
  '[id*="metafields.custom.google_"]',
  '[id*="metafields.custom.*google"]',
  '[id*="VARIANT.metafields.custom.google"]',
  '[id*="VARIANT.metafields.custom.google_"]',
  '[id*="VARIANT.metafields.custom.*google"]',
  '[id*="PRODUCT.metafields.custom.google"]',
  '[id*="PRODUCT.metafields.custom.google_"]',
  '[id*="PRODUCT.metafields.custom.*google"]',
  '[id*="metafields.mm-google-shopping"]',
  '[id*="VARIANT.metafields.mm-google-shopping"]',
  '[id*="PRODUCTVARIANT.metafields.mm-google-shopping"]',
  '[id*="PRODUCT.metafields.mm-google-shopping"]',
];
```

### Strategy 2: Input Attribute Checking

The system checks all input fields for Google-related attributes:

- `name` attribute containing "google"
- `id` attribute containing "google"
- `placeholder` attribute containing "google"
- `aria-label` attribute containing "google"
- Parent metafield container ID containing "google" or "mm-google-shopping"

### Strategy 3: ReadField Content Detection

The system searches for ReadField elements within Google-related metafield containers:

```javascript
const readFields = document.querySelectorAll('[class*="ReadField"]');
for (const field of readFields) {
  const container = field.closest('[id*="metafield"]');
  if (
    container &&
    (container.id.includes("google") ||
      container.id.includes("mm-google-shopping"))
  ) {
    // Check if the ReadField is EMPTY or has placeholder class
    const textContent = field.textContent?.trim();
    if (
      !textContent ||
      textContent === "" ||
      field.classList.contains("_ReadField--placeholder_123bh_29")
    ) {
      // This is a Google-related ReadField that is EMPTY
    }
  }
}
```

## Target Elements

### Metafield Containers

The system looks for metafield containers with these ID patterns:

1. **Custom Google Metafields**:

   - `PRODUCT.metafields.custom.google_*`
   - `VARIANT.metafields.custom.google_*`
   - `PRODUCTVARIANT.metafields.custom.google_*`

2. **Google Shopping Metafields**:
   - `PRODUCT.metafields.mm-google-shopping.*`
   - `VARIANT.metafields.mm-google-shopping.*`
   - `PRODUCTVARIANT.metafields.mm-google-shopping.*`

### Input Fields

Within these metafield containers, the system detects:

- Standard `<input>` elements with values
- Text inputs, number inputs, and other input types
- Both visible and hidden inputs

### ReadField Elements

The system also detects ReadField elements that display Google data:

- Elements with class `_ReadField_123bh_9` or similar
- Elements within Google-related metafield containers
- Elements with empty or no text content
- Elements with the placeholder CSS class `_ReadField--placeholder_123bh_29`

## Visual Indicators

When Google inputs are detected, the system provides two visual indicators:

### 1. Orange Highlight Border

Detected Google inputs are highlighted with an orange border:

```css
.scout-google-input-warning {
  border: 2px solid #f59e0b !important;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1) !important;
  animation: scout-pulse-orange 2s ease-in-out infinite;
}
```

### 2. Notification Popup

A notification popup appears in the top-right corner:

- **Title**: "Google Inputs Detected!"
- **Message**: Shows the count of EMPTY Google input fields
- **Color**: Orange/yellow theme to indicate a warning
- **Action**: Can be dismissed with the × button

## Example HTML Structure

Here's an example of the HTML structure that the detection system targets:

```html
<div
  class="Polaris-Box"
  style="--pc-box-padding-block-start-xs: var(--p-space-400); --pc-box-padding-block-end-xs: var(--p-space-400);"
>
  <div>
    <div>
      <div
        class="Polaris-Box"
        style="--pc-box-padding-block-end-xs: var(--p-space-200);"
      >
        <div class="_ActivatorWrapper_xxurb_91">
          <div
            id="PRODUCTVARIANT.metafields.mm-google-shopping.custom_label_0-anchor"
          >
            <div
              role="button"
              tabindex="0"
              aria-label="Edit Google: Brand metafield"
              class="_ActivatorButton_xxurb_95"
            >
              <div class="_RowWrapper_xxurb_22">
                <div class="_HoverArea_xxurb_4">
                  <div class="_HoverContainer_xxurb_8">
                    <div class="_FormFieldLabel_xxurb_48">
                      <label for="Google: Brand" class="_TruncateLabel_xxurb_59"
                        ><p
                          class="Polaris-Text--root Polaris-Text--bodyMd Polaris-Text--breakAlways"
                        >
                          Google: Brand
                        </p></label
                      >
                    </div>
                    <span class="_ReadField_xxurb_191"
                      ><div class="_ReadWrapper_123bh_1">
                        <div
                          class="_ReadField_123bh_9 _ReadField--no-badge-padding_123bh_19"
                        >
                          HP
                        </div>
                      </div></span
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div>
      <div
        class="Polaris-Box"
        style="--pc-box-padding-block-end-xs: var(--p-space-200);"
      >
        <div class="_ActivatorWrapper_xxurb_91">
          <div id="PRODUCTVARIANT.metafields.mm-google-shopping.mpn-anchor">
            <div
              role="button"
              tabindex="0"
              aria-label="Edit Google: MPN metafield"
              class="_ActivatorButton_xxurb_95"
            >
              <div class="_RowWrapper_xxurb_22">
                <div class="_HoverArea_xxurb_4">
                  <div class="_HoverContainer_xxurb_8">
                    <div class="_FormFieldLabel_xxurb_48">
                      <label for="Google: MPN" class="_TruncateLabel_xxurb_59"
                        ><p
                          class="Polaris-Text--root Polaris-Text--bodyMd Polaris-Text--breakAlways"
                        >
                          Google: MPN
                        </p></label
                      >
                    </div>
                    <span class="_ReadField_xxurb_191"
                      ><div class="_ReadWrapper_123bh_1">
                        <div
                          class="_ReadField_123bh_9 _ReadField--no-badge-padding_123bh_19"
                        >
                          14-DQ0055DX
                        </div>
                      </div></span
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div>
      <div
        class="Polaris-Box"
        style="--pc-box-padding-block-end-xs: var(--p-space-200);"
      >
        <div class="_ActivatorWrapper_xxurb_91">
          <div
            id="PRODUCTVARIANT.metafields.mm-google-shopping.custom_label_1-anchor"
          >
            <div
              role="button"
              tabindex="0"
              aria-label="Edit Google: UPC (GTIN) metafield"
              class="_ActivatorButton_xxurb_95"
            >
              <div class="_RowWrapper_xxurb_22">
                <div class="_HoverArea_xxurb_4">
                  <div class="_HoverContainer_xxurb_8">
                    <div class="_FormFieldLabel_xxurb_48">
                      <label
                        for="Google: UPC (GTIN)"
                        class="_TruncateLabel_xxurb_59"
                        ><p
                          class="Polaris-Text--root Polaris-Text--bodyMd Polaris-Text--breakAlways"
                        >
                          Google: UPC (GTIN)
                        </p></label
                      >
                    </div>
                    <span class="_ReadField_xxurb_191"
                      ><div class="_ReadWrapper_123bh_1">
                        <div
                          class="_ReadField_123bh_9 _ReadField--no-badge-padding_123bh_19"
                        >
                          <span
                            class="scout-upc-highlight"
                            data-upc="196548430222"
                            title="Click to copy UPC: 196548430222"
                            >196548430222</span
                          >
                        </div>
                      </div></span
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

## Event Handling

The system uses a comprehensive event handling system similar to the eBay condition detection:

1. **Input Events**: Triggers when the value of an input changes
2. **Change Events**: Triggers when an input loses focus after a change
3. **Comprehensive Mutation Observer**: Monitors for various types of DOM changes:
   - Child list changes (nodes added/removed)
   - Character data changes (text content updates)
   - Attribute changes (class, id modifications)
   - Changes within Google metafield containers
4. **Visibility Change Events**: Rechecks when the tab becomes active
5. **Periodic Checks**: Runs every 5 seconds as a safety net
6. **Save Button Detection**: Triggers when save buttons or Google/condition fields are clicked
7. **Chrome Runtime Messages**: Responds to extension messages for rechecking

The mutation observer uses debouncing (300ms delay) to avoid excessive calls and improve performance.

## Testing

A test script is available at `../scout/test-google-inputs.js` that can be used to verify the detection functionality:

1. Navigate to a Shopify product admin page
2. Open the browser console
3. Copy and paste the test script content
4. Press Enter to run the script
5. Check for orange borders and notification popups

## Configuration

The detection threshold is set to 1, meaning that if any EMPTY Google-related input is detected, the warning will be shown. This can be adjusted in the code by modifying the return value in the `findGoogleInputs()` function.

## Troubleshooting

If Google inputs are not being detected:

1. Check that the metafield IDs match one of the supported patterns
2. Verify that inputs or ReadFields are actually empty (no value or whitespace)
3. Ensure the content script is running on the Shopify admin page
4. Check the browser console for any error messages
5. Run the test script to verify basic functionality
