import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Loader2, Pencil, RefreshCw, X } from "lucide-react";
import QRCode from "qrcode";
import {
  getMobileScannerExtensionIdentity,
  saveMobileScannerSessionLabel,
} from "../../src/domain/mobile-scanner-session";
import "./mobile-scanner-popup.css";

type AppClipGrantState =
  | { status: "loading"; error: null; qrCodeUrl: null }
  | { status: "ready"; error: null; qrCodeUrl: string }
  | { status: "error"; error: string; qrCodeUrl: null };

function MobileScannerPopup() {
  const [state, setState] = useState<AppClipGrantState>({
    status: "loading",
    error: null,
    qrCodeUrl: null,
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState("");
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [labelSaved, setLabelSaved] = useState(false);

  const createGrant = useCallback(async (label: string) => {
    setState({ status: "loading", error: null, qrCodeUrl: null });
    try {
      const response = await chrome.runtime.sendMessage({
        action: "accessCreateAppClipGrant",
        label,
      });
      const qrCodeUrl = response?.value?.qrCodeUrl;
      if (response?.success !== true || typeof qrCodeUrl !== "string") {
        throw new Error(response?.error ?? "Could not create App Clip QR");
      }
      setState({ status: "ready", error: null, qrCodeUrl });
    } catch (error) {
      setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        qrCodeUrl: null,
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getMobileScannerExtensionIdentity()
      .then((identity) => {
        if (cancelled) return;
        setSessionLabel(identity.sessionLabel);
        setIdentityLoaded(true);
        void createGrant(identity.sessionLabel);
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = "Chrome computer";
        setSessionLabel(fallback);
        setIdentityLoaded(true);
        void createGrant(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [createGrant]);

  const saveSessionLabel = useCallback(async () => {
    const identity = await saveMobileScannerSessionLabel(sessionLabel);
    setSessionLabel(identity.sessionLabel);
    await createGrant(identity.sessionLabel);
    setLabelSaved(true);
    window.setTimeout(() => setLabelSaved(false), 1000);
  }, [createGrant, sessionLabel]);

  useEffect(() => {
    if (!state.qrCodeUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(state.qrCodeUrl, {
      width: 768,
      margin: 3,
      errorCorrectionLevel: "H",
      color: { dark: "#1c1917", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [state.qrCodeUrl]);

  return (
    <main className="popup-shell" aria-live="polite">
      <label className="popup-session-field">
        <Pencil aria-hidden="true" />
        <input
          value={sessionLabel}
          onChange={(event) => setSessionLabel(event.target.value)}
          onBlur={() => void saveSessionLabel().catch(() => undefined)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          disabled={!identityLoaded}
          maxLength={80}
          placeholder="Computer name"
          aria-label="Computer name"
        />
        {labelSaved ? <span>Saved</span> : null}
      </label>

      {qrDataUrl ? (
        <div className="popup-qr-stack">
          <div className="popup-qr-frame">
            <img
              src={qrDataUrl}
              alt="Open this workspace in the Volt App Clip"
              className="popup-qr-image"
            />
          </div>
          <p>Scan with your iPhone to open this workspace in the Volt App Clip.</p>
        </div>
      ) : (
        <div className="popup-message">
          {state.status === "error" ? (
            <X aria-hidden="true" />
          ) : (
            <Loader2 className="animate-spin" aria-hidden="true" />
          )}
          <strong>{state.status === "error" ? "Could not create QR" : "Preparing QR"}</strong>
          <p>{state.error ?? "Creating a secure workspace link."}</p>
          {state.status === "error" ? (
            <button className="popup-retry" onClick={() => void createGrant(sessionLabel)}>
              <RefreshCw aria-hidden="true" /> Retry
            </button>
          ) : null}
        </div>
      )}
    </main>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Mobile scanner popup root element not found");
createRoot(container).render(<MobileScannerPopup />);
