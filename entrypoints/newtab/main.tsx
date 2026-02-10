import { createRoot } from "react-dom/client";
import NewTab from "./NewTab";
import "./newtab.css";
import "../../src/components/cmdk-palette/styles.css";

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("root");
  if (container) {
    const root = createRoot(container);
    root.render(<NewTab />);
  }
});
