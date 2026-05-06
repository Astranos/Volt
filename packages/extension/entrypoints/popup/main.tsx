import { createRoot } from "react-dom/client";
import CMDKPopup from "../../src/components/popups/CMDKPopup";
import "./popup.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Popup root element not found");
}

const root = createRoot(container);
root.render(<CMDKPopup />);
