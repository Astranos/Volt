import { createRoot } from "react-dom/client";
import UnifiedSidepanel from "../../src/components/sidepanel/UnifiedSidepanel";
import "./sidepanel.css";

/**
 * @fileoverview Volt Chrome Extension Side Panel Script
 * @description Manages the side panel functionality with tabbed navigation
 * @version 2.0.0
 * @author Juan Quenga
 * @license MIT
 */

// Initialize the sidepanel
const initSidepanel = () => {
  const container = document.getElementById("volt-sidepanel-container");
  if (!container) {
    console.error("Sidepanel container not found");
    return;
  }

  const root = createRoot(container);
  root.render(<UnifiedSidepanel />);
};

// Try to initialize immediately
initSidepanel();

// Also initialize on DOMContentLoaded as a fallback
document.addEventListener("DOMContentLoaded", initSidepanel);
