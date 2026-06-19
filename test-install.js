// Test script to verify the install page functionality
// This script can be run in the browser console to test the install page

console.log("Testing Volt Install Page...");

// Test 1: Check if the install page exists
fetch(chrome.runtime.getURL("/install.html"))
  .then((response) => {
    if (response.ok) {
      console.log("✅ Install page is accessible");
      return response.text();
    } else {
      console.error("❌ Install page not accessible");
    }
  })
  .then((html) => {
    if (html && html.includes("Install Volt")) {
      console.log("✅ Install page contains expected content");
    } else {
      console.error("❌ Install page content is incorrect");
    }
  })
  .catch((error) => {
    console.error("❌ Error accessing install page:", error);
  });

// Test 2: Check if the main landing page has the install button
fetch(chrome.runtime.getURL("/options.html"))
  .then((response) => {
    if (response.ok) {
      return response.text();
    } else {
      console.error("❌ Options page not accessible");
    }
  })
  .then((html) => {
    if (html && html.includes("Install Extension")) {
      console.log("✅ Landing page has install button");
    } else {
      console.error("❌ Landing page missing install button");
    }
  })
  .catch((error) => {
    console.error("❌ Error accessing options page:", error);
  });

console.log("Test completed. Check the console for results.");
