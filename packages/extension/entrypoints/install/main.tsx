import { createRoot } from "react-dom/client";
import ThankYouPage from "../../src/components/landing/ThankYouPage";

const container = document.getElementById("app");
if (!container) throw new Error("Failed to find the app element");
const root = createRoot(container);
root.render(<ThankYouPage />);
