// Test script to verify Google input detection
// This script can be run in the browser console on a Shopify product page

console.log("Testing Google input detection...");

// Create mock metafield elements with Google-related IDs
function createMockGoogleMetafields() {
  const mockContainer = document.createElement("div");
  mockContainer.id = "VARIANT.metafields.custom.google_product_type-anchor";
  mockContainer.style.display = "none";

  const mockInput = document.createElement("input");
  mockInput.type = "text";
  mockInput.value = "Test Google Value";
  mockContainer.appendChild(mockInput);

  document.body.appendChild(mockContainer);

  const mockContainer2 = document.createElement("div");
  mockContainer2.id = "VARIANT.metafields.custom.google_category-anchor";
  mockContainer2.style.display = "none";

  const mockInput2 = document.createElement("input");
  mockInput2.type = "text";
  mockInput2.value = "Electronics";
  mockContainer2.appendChild(mockInput2);

  document.body.appendChild(mockContainer2);

  console.log("Created mock Google metafields");
}

// Create mock ReadField with Google data
function createMockGoogleReadField() {
  const mockContainer = document.createElement("div");
  mockContainer.id = "VARIANT.metafields.custom.google_brand-anchor";
  mockContainer.style.display = "none";

  const mockReadField = document.createElement("div");
  mockReadField.className =
    "_ReadField_123bh_9 _ReadField--placeholder_123bh_29 _ReadField--no-badge-padding_123bh_19";
  mockReadField.textContent = ""; // Empty content to trigger warning
  mockContainer.appendChild(mockReadField);

  document.body.appendChild(mockContainer);

  console.log("Created mock Google ReadField");
}

// Run the test
createMockGoogleMetafields();
createMockGoogleReadField();

// Wait a moment and then check if they're detected
setTimeout(() => {
  console.log("Checking for Google inputs...");

  // Check for metafield inputs
  const metafieldInputs = document.querySelectorAll(
    '[id*="metafields.custom.google"] input'
  );
  console.log(
    `Found ${metafieldInputs.length} metafield inputs with Google in ID`
  );

  // Check for ReadFields in Google metafields
  const readFields = document.querySelectorAll(
    '[id*="metafield"][id*="google"] [class*="ReadField"]'
  );
  console.log(`Found ${readFields.length} ReadFields in Google metafields`);

  // Check if the volt script is detecting them
  const highlightedElements = document.querySelectorAll(
    ".volt-google-input-warning"
  );
  console.log(`Found ${highlightedElements.length} highlighted Google inputs`);

  // Check for notifications
  const notifications = document.querySelectorAll(".volt-google-warning");
  console.log(`Found ${notifications.length} Google warning notifications`);

  // Clean up
  document
    .querySelectorAll(
      '[id*="metafields.mm-google-shopping"], [id*="metafields.custom.google"]'
    )
    .forEach((el) => el.remove());

  console.log(
    "Test complete. If you see highlighted elements or notifications, the detection is working."
  );
}, 2000);
