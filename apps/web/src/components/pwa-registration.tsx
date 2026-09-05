import { useEffect } from "react";

/** Register only in production so a worker never intercepts Vite development. */
export function PwaRegistration() {
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    // Registration is optional. A denied worker must not block the workspace.
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  return null;
}
