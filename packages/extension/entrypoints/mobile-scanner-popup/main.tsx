import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Calculator, CheckCircle2, Loader2, Pencil, Smartphone, X } from "lucide-react";
import QRCode from "qrcode";
import type { ScannerConnectionStatus } from "@volt/scanner-protocol";
import {
  PrimaryActionButton,
  SecondaryActionButton,
} from "../../src/components/sidepanel/mobile-shared";
import type { SidepanelToolId } from "../../src/lib/sidepanel-tools";
import {
  getMobileScannerExtensionIdentity,
  saveMobileScannerSessionLabel,
  type ExtensionIdentity,
} from "../../src/domain/mobile-scanner-session";
import "../sidepanel/sidepanel.css";
import "./mobile-scanner-popup.css";

type MobileCaptureMode = "ocr" | "barcode" | "dictation" | "photo";

type MobileScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  connectedAt?: string | null;
  joinWindowExpiresAt?: string | null;
  mode?: MobileCaptureMode | null;
  extensionIdentity?: ExtensionIdentity | null;
};

const modeLabels: Record<MobileCaptureMode, string> = {
  ocr: "Text capture",
  barcode: "Barcode scanner",
  dictation: "Dictation",
  photo: "Photo capture",
};

function normalizeMode(value: string | null): MobileCaptureMode | null {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo"
    ? value
    : null;
}

function MobileScannerPopup() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedMode = useMemo(() => normalizeMode(searchParams.get("mode")), [searchParams]);
  const openedAt = useMemo(() => Date.now(), []);
  const [state, setState] = useState<MobileScannerState>({
    status: "creating",
    qrCodeUrl: null,
    error: null,
    mode: requestedMode,
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState("");
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [labelSaved, setLabelSaved] = useState(false);

  const applyScannerState = useCallback((nextState: Partial<MobileScannerState> | null | undefined) => {
    if (!nextState) return;
    setState((current) => ({ ...current, ...nextState }));
  }, []);

  const refreshState = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ action: "scannerGetState" });
    applyScannerState(response?.state);
    return response?.state as MobileScannerState | undefined;
  }, [applyScannerState]);

  const saveSessionLabel = useCallback(async () => {
    const identity = await saveMobileScannerSessionLabel(sessionLabel);
    setSessionLabel(identity.sessionLabel);
    setLabelSaved(true);
    window.setTimeout(() => setLabelSaved(false), 1000);
    await chrome.runtime
      .sendMessage({ action: "scannerUpdateExtensionIdentity", identity })
      .catch(() => {});
    return identity;
  }, [sessionLabel]);

  const startSession = useCallback(async (force = false) => {
    setState((current) => ({ ...current, status: "creating", error: null }));
    await saveSessionLabel();
    const response = await chrome.runtime.sendMessage({
      action: "scannerStartForMode",
      force,
      mode: requestedMode,
    });
    if (response?.state) applyScannerState(response.state);
    if (response?.error) {
      setState((current) => ({ ...current, status: "error", error: response.error }));
    }
  }, [applyScannerState, requestedMode, saveSessionLabel]);

  const ensureJoinWindow = useCallback(async (currentState?: MobileScannerState) => {
    if (currentState?.qrCodeUrl) return;
    await startSession(false);
  }, [startSession]);

  useEffect(() => {
    let cancelled = false;
    void getMobileScannerExtensionIdentity()
      .then((identity) => {
        if (cancelled) return;
        setSessionLabel(identity.sessionLabel);
        setIdentityLoaded(true);
        void chrome.runtime
          .sendMessage({ action: "scannerUpdateExtensionIdentity", identity })
          .catch(() => {});
      })
      .catch(() => {
        if (!cancelled) {
          setSessionLabel("Chrome session");
          setIdentityLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!identityLoaded) return;
    const timer = window.setTimeout(() => {
      void saveSessionLabel().catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer);
  }, [identityLoaded, saveSessionLabel]);

  useEffect(() => {
    let cancelled = false;
    refreshState()
      .then((nextState) => {
        if (cancelled) return;
        if (nextState?.status !== "connected") {
          void ensureJoinWindow(nextState);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ensureJoinWindow, refreshState]);

  useEffect(() => {
    const listener = (message: any) => {
      if (message?.action !== "scannerStateChanged") return;
      applyScannerState(message.state);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [applyScannerState]);

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

  useEffect(() => {
    if (state.status !== "connected") return;
    const connectedAt = state.connectedAt ? Date.parse(state.connectedAt) : Number.NaN;
    if (!Number.isFinite(connectedAt) || connectedAt < openedAt - 1_000) return;
    const timer = window.setTimeout(() => window.close(), 650);
    return () => window.clearTimeout(timer);
  }, [openedAt, state.connectedAt, state.status]);

  useEffect(() => {
    if (state.status !== "waiting" || !state.joinWindowExpiresAt) return;
    const expiresAt = Date.parse(state.joinWindowExpiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const refreshInMs = Math.max(0, expiresAt - Date.now() - 5_000);
    const timer = window.setTimeout(() => {
      void startSession(true);
    }, refreshInMs);
    return () => window.clearTimeout(timer);
  }, [startSession, state.joinWindowExpiresAt, state.status]);

  useEffect(() => {
    let sent = false;
    const notifyClosed = () => {
      if (sent) return;
      sent = true;
      try {
        chrome.runtime.sendMessage({ action: "scannerPairingPopupClosed" });
      } catch (_error) {}
    };

    window.addEventListener("pagehide", notifyClosed);
    window.addEventListener("beforeunload", notifyClosed);
    return () => {
      window.removeEventListener("pagehide", notifyClosed);
      window.removeEventListener("beforeunload", notifyClosed);
      notifyClosed();
    };
  }, []);

  const openSidepanelTool = useCallback(async (tool: SidepanelToolId) => {
    await chrome.runtime.sendMessage({ action: "openInSidebar", tool });
    window.close();
  }, []);

  const title = "Mobile Scanner";
  const subtitle = state.status === "connected" ? "Connected to this browser" : "Scan QR code with app";
  const showQr = Boolean(qrDataUrl) && (state.status === "waiting" || state.status === "connected");

  return (
    <div className="popup-shell">
      <section className="popup-hero">
        <div className="popup-title-row">
          <span className="popup-icon">
            {state.status === "connected" ? <CheckCircle2 className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          </span>
          <div className="popup-title-copy">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <PopupStatus status={state.status} />
        </div>

        <div className="popup-session-card">
          <label className="popup-session-label">
          <Pencil className="h-3 w-3" />
          Chrome session name
          </label>
          <input
            value={sessionLabel}
            onChange={(event) => setSessionLabel(event.target.value)}
            onBlur={() => void saveSessionLabel().catch(() => {})}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            disabled={!identityLoaded}
            maxLength={80}
            className="popup-session-input"
            placeholder="Chrome session"
            aria-label="Chrome session name"
          />
          <div className="popup-session-help">
            {labelSaved ? "Saved for future QR sessions" : "Reused by this browser profile"}
          </div>
        </div>
      </section>

      <main className="popup-main">
        {showQr && qrDataUrl ? (
          <PopupQrCode qrDataUrl={qrDataUrl} />
        ) : state.status === "connected" ? (
          <div className="popup-message">
            <span className="popup-message-icon popup-message-icon-success">
              <CheckCircle2 className="h-8 w-8" />
            </span>
            <div className="popup-message-title">Connected</div>
            <p>
              Continue scanning on your phone. Results land in the sidepanel.
            </p>
          </div>
        ) : (
          <div className="popup-message">
            <span className="popup-message-icon">
              {state.status === "error" ? <X className="h-7 w-7" /> : <Loader2 className="h-7 w-7 animate-spin" />}
            </span>
            <div className="popup-message-title">
              {state.status === "error" ? "Could not create QR" : "Preparing QR"}
            </div>
            <p>
              {state.error ?? "Creating a secure mobile scanner session."}
            </p>
          </div>
        )}
      </main>

      <footer className="popup-actions">
        <SecondaryActionButton
          onClick={() => void openSidepanelTool("top-offers")}
          className="popup-action-button"
        >
          <Calculator className="h-4 w-4" />
          Offer Calculator
        </SecondaryActionButton>
        <PrimaryActionButton
          onClick={() => void openSidepanelTool("mobile-scanner")}
          className="popup-action-button"
        >
          <Smartphone className="h-4 w-4" />
          Mobile Scanner
        </PrimaryActionButton>
      </footer>
    </div>
  );
}

function PopupQrCode({ qrDataUrl }: { qrDataUrl: string }) {
  return (
    <div className="popup-qr-frame">
      <img
        src={qrDataUrl}
        alt="Scan this QR code with the Volt mobile app"
        className="popup-qr-image"
      />
    </div>
  );
}

function PopupStatus({ status }: { status: ScannerConnectionStatus }) {
  const label =
    status === "connected"
      ? "Connected"
      : status === "waiting"
        ? "Ready"
        : status === "creating"
          ? "Creating"
          : status === "error"
            ? "Error"
            : "Idle";
  const tone =
    status === "connected"
      ? "popup-status-connected"
      : status === "error"
        ? "popup-status-error"
        : status === "waiting"
          ? "popup-status-ready"
          : "popup-status-idle";
  return (
    <span className={`popup-status ${tone}`}>
      {label}
    </span>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Mobile scanner popup root element not found");
}

createRoot(container).render(<MobileScannerPopup />);
