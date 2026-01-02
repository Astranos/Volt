import { createRoot } from "react-dom/client";
import SettingsPage from "../../src/components/pages/SettingsPage";
import "./options.css";

/**
 * @fileoverview PayMore Chrome Extension Options/Settings Page
 * @description Extension Settings configuration page
 * @version 1.0.0
 * @author Juan Quenga
 * @license MIT
 */

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("root");
  if (container) {
    const root = createRoot(container);
    root.render(<SettingsPage />);
  }
});
