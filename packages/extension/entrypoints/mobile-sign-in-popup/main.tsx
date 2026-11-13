import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import QRCode from "qrcode";
import "./mobile-sign-in-popup.css";

type PopupState =
  | { status: "loading" }
  | { status: "ready"; qrDataUrl: string; expiresAt: number }
  | { status: "mfa" }
  | { status: "closed"; dismissed: boolean }
  | { status: "error"; error: string };

const requestId = new URLSearchParams(window.location.search).get("requestId") ?? "";

async function sendSignInMessage(action: "mobileSignInIssueQr" | "mobileSignInDismiss") {
  const response = await chrome.runtime.sendMessage({ action, requestId });
  if (response?.success !== true) {
    throw new Error(typeof response?.error === "string" ? response.error : "Something went wrong.");
  }
  return response.value as unknown;
}

function formatRemaining(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function MobileSignInPopup() {
  const [state, setState] = useState<PopupState>({ status: "loading" });
  const [now, setNow] = useState(Date.now());
  const [dismissing, setDismissing] = useState(false);

  const issueQr = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const value = await sendSignInMessage("mobileSignInIssueQr") as { qrCodeUrl?: unknown; expiresAt?: unknown };
      if (typeof value?.qrCodeUrl !== "string" || typeof value.expiresAt !== "number") {
        throw new Error("The sign-in QR response was incomplete.");
      }
      const qrDataUrl = await QRCode.toDataURL(value.qrCodeUrl, {
        width: 768,
        margin: 3,
        errorCorrectionLevel: "M",
        color: { dark: "#1c1917", light: "#ffffff" },
      });
      setState({ status: "ready", qrDataUrl, expiresAt: value.expiresAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("SIGN_IN_MFA_REQUIRED")) setState({ status: "mfa" });
      else if (message.includes("SIGN_IN_REQUEST_CLOSED")) setState({ status: "closed", dismissed: false });
      else setState({ status: "error", error: message });
    }
  }, []);

  useEffect(() => {
    if (!requestId) {
      setState({ status: "error", error: "This sign-in link is missing its request." });
      return;
    }
    void issueQr();
  }, [issueQr]);

  // The background broadcasts when the request is scanned, dismissed on another
  // computer, or expires.
  useEffect(() => {
    const listener = (message: unknown) => {
      const record = message as { action?: unknown; requestId?: unknown } | null;
      if (record?.action === "mobileSignInRequestClosed" && record.requestId === requestId) {
        setState((current) => current.status === "closed" ? current : { status: "closed", dismissed: false });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (state.status !== "ready") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  useEffect(() => {
    if (state.status === "ready" && state.expiresAt <= now) setState({ status: "closed", dismissed: false });
  }, [now, state]);

  useEffect(() => {
    if (state.status !== "closed") return;
    const timer = window.setTimeout(() => window.close(), 4000);
    return () => window.clearTimeout(timer);
  }, [state.status]);

  const dismiss = useCallback(async () => {
    setDismissing(true);
    try {
      await sendSignInMessage("mobileSignInDismiss");
      setState({ status: "closed", dismissed: true });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
    } finally {
      setDismissing(false);
    }
  }, []);

  return (
    <main className="popup-shell" aria-live="polite">
      {state.status === "ready" ? (
        <div className="popup-qr-stack">
          <h1 className="sign-in-title">Scan with your iPhone</h1>
          <div className="popup-qr-frame">
            <img src={state.qrDataUrl} alt="QR code that signs in the Volt iPhone app" className="popup-qr-image" />
          </div>
          <p>Scan this with the Volt app on the iPhone that asked to sign in. It only works on that iPhone.</p>
          <span className="sign-in-expiry">Expires in {formatRemaining(state.expiresAt - now)}</span>
          <button className="sign-in-dismiss" onClick={() => void dismiss()} disabled={dismissing}>
            I didn't ask for this
          </button>
        </div>
      ) : (
        <div className="popup-message">
          {state.status === "loading" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {state.status === "closed" ? <CheckCircle2 aria-hidden="true" /> : null}
          {state.status === "mfa" ? <ShieldAlert aria-hidden="true" /> : null}
          {state.status === "error" ? <X aria-hidden="true" /> : null}
          <strong>
            {state.status === "loading" && "Preparing QR"}
            {state.status === "closed" && (state.dismissed ? "Request declined" : "Request finished")}
            {state.status === "mfa" && "Use regular sign-in"}
            {state.status === "error" && "Could not show QR"}
          </strong>
          <p>
            {state.status === "loading" && "Creating a one-time sign-in code."}
            {state.status === "closed" && (state.dismissed
              ? "The iPhone was not signed in."
              : "This sign-in request was used, declined, or expired.")}
            {state.status === "mfa" && "Your account uses two-step verification, so QR sign-in is off. Sign in on your iPhone with your email and verification code instead."}
            {state.status === "error" && state.error}
          </p>
          {state.status === "error" && requestId ? (
            <button className="popup-retry" onClick={() => void issueQr()}>
              <RefreshCw aria-hidden="true" /> Retry
            </button>
          ) : null}
          {state.status === "mfa" ? (
            <button className="sign-in-dismiss" onClick={() => void dismiss()} disabled={dismissing}>
              Close request
            </button>
          ) : null}
        </div>
      )}
    </main>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Mobile sign-in popup root element not found");
createRoot(container).render(<MobileSignInPopup />);
