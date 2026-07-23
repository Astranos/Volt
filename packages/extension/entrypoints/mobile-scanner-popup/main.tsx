import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Calculator, CheckCircle2, Cloud, Loader2, Pencil, PlusCircle, Settings, Smartphone, Unplug, X } from "lucide-react";
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
import {
  ExtensionAccessPanel,
  ExtensionClerkProvider,
} from "../../src/components/access/ExtensionAccess";
import "../sidepanel/sidepanel.css";
import "./mobile-scanner-popup.css";

type MobileCaptureMode = "ocr" | "barcode" | "dictation" | "photo";

type MobileScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  connectedAt?: string | null;
  connectedPeerCount?: number;
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

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isJoinWindowActive(state?: Pick<MobileScannerState, "qrCodeUrl" | "joinWindowExpiresAt"> | null) {
  if (!state?.qrCodeUrl) return false;
  if (!state.joinWindowExpiresAt) return true;
  const expiresAt = Date.parse(state.joinWindowExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
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
  const [enrollmentQrDataUrl, setEnrollmentQrDataUrl] = useState<string | null>(null);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [creatingEnrollment, setCreatingEnrollment] = useState(false);

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
    if (isJoinWindowActive(currentState)) return;
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
        void ensureJoinWindow(nextState);
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
    const listener = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const event = message as {
        action?: unknown;
        state?: Partial<MobileScannerState>;
      };
      if (event.action !== "scannerStateChanged") return;
      applyScannerState(event.state);
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
    if (!state.qrCodeUrl || !state.joinWindowExpiresAt) return;
    const expiresAt = Date.parse(state.joinWindowExpiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const refreshInMs = Math.max(0, expiresAt - Date.now() - 5_000);
    const timer = window.setTimeout(() => {
      void startSession(true);
    }, refreshInMs);
    return () => window.clearTimeout(timer);
  }, [startSession, state.joinWindowExpiresAt, state.qrCodeUrl]);

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
    try {
      await chrome.runtime.sendMessage({ action: "openInSidebar", tool, mode: "open" });
    } finally {
      window.close();
    }
  }, []);

  const openSettings = useCallback(async () => {
    await chrome.runtime.sendMessage({ action: "open-settings" });
    window.close();
  }, []);

  const disconnect = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({
      action: "scannerDisconnect",
    });
    applyScannerState(response?.state);
  }, [applyScannerState]);

  const createFullAppEnrollment = useCallback(async () => {
    setCreatingEnrollment(true);
    setEnrollmentError(null);
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        action: "workspaceCreateEnrollment",
        label: sessionLabel || "Volt for iPhone",
      });
      const responseRecord = recordFrom(response);
      const value = recordFrom(responseRecord?.value);
      if (responseRecord?.success !== true || typeof value?.enrollmentUrl !== "string") {
        throw new Error(typeof responseRecord?.error === "string" ? responseRecord.error : "Could not create enrollment QR.");
      }
      const qr = await QRCode.toDataURL(value.enrollmentUrl, {
        width: 768,
        margin: 3,
        errorCorrectionLevel: "H",
        color: { dark: "#1c1917", light: "#ffffff" },
      });
      setEnrollmentQrDataUrl(qr);
    } catch (error) {
      setEnrollmentError(error instanceof Error ? error.message : "Could not create enrollment QR.");
    } finally {
      setCreatingEnrollment(false);
    }
  }, [sessionLabel]);

  const title = "Mobile Scanner";
  const connectedCount = state.connectedPeerCount ?? 0;
  const subtitle = state.status === "connected"
    ? connectedCount > 1
      ? `${connectedCount} phones connected`
      : "Connected to this browser"
    : "Scan QR code with app";
  const showQr = Boolean(qrDataUrl) && (state.status === "waiting" || state.status === "connected");
  const pairingHint = state.status === "connected"
    ? "Scan this QR with another phone to add it to this browser session."
    : "Scan this QR with Volt on your phone.";

  return (
    <div className="popup-shell">
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
          Scanner Results
        </PrimaryActionButton>
      </footer>

      <ExtensionAccessPanel surface="popup" />

      <section className="popup-hero">
        <div className="popup-title-row">
          <span className="popup-icon">
            {state.status === "connected" ? <CheckCircle2 className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          </span>
          <div className="popup-title-copy">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <button
            type="button"
            className="popup-settings-button"
            onClick={() => void openSettings()}
            aria-label="Open settings"
            title="Open settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        <div className="popup-session-card">
          <label className="popup-session-label">
            <span className="popup-session-label-main">
              <Pencil className="h-3 w-3" />
              Session name
            </span>
            {labelSaved ? <span className="popup-session-saved">Saved</span> : null}
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
        </div>
      </section>

      <main className="popup-main">
        {showQr && qrDataUrl ? (
          <PopupQrCode qrDataUrl={qrDataUrl} hint={pairingHint} />
        ) : state.status === "connected" ? (
          <div className="popup-message">
            <span className="popup-message-icon popup-message-icon-success">
              <CheckCircle2 className="h-8 w-8" />
            </span>
            <div className="popup-message-title">Connected</div>
            <p>
              Continue scanning on your phone. Results land in the sidepanel.
            </p>
            <button
              type="button"
              className="popup-pair-another-button"
              onClick={() => void startSession(true)}
            >
              <PlusCircle className="h-4 w-4" />
              Pair another phone
            </button>
            <button
              type="button"
              className="popup-disconnect-button"
              onClick={() => void disconnect()}
            >
              <Unplug className="h-4 w-4" />
              End work session
            </button>
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

      <button
        type="button"
        className="popup-enrollment-trigger"
        onClick={() => void createFullAppEnrollment()}
        disabled={creatingEnrollment}
      >
        {creatingEnrollment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
        Enroll full app for cloud sync
      </button>

      {enrollmentQrDataUrl || enrollmentError ? (
        <div className="popup-enrollment-overlay" role="dialog" aria-modal="true" aria-label="Enroll full Volt app">
          <div className="popup-enrollment-card">
            <button
              type="button"
              className="popup-enrollment-close"
              onClick={() => {
                setEnrollmentQrDataUrl(null);
                setEnrollmentError(null);
              }}
              aria-label="Close enrollment QR"
            >
              <X className="h-4 w-4" />
            </button>
            <Cloud className="h-6 w-6" />
            <h2>Enroll full app</h2>
            {enrollmentQrDataUrl ? (
              <>
                <div className="popup-enrollment-qr-frame">
                  <img src={enrollmentQrDataUrl} alt="One-time QR to enroll Volt for iPhone" />
                </div>
                <p>Scan in the full Volt app once. This QR contains a short-lived enrollment code, never your account token.</p>
              </>
            ) : (
              <p className="popup-enrollment-error">{enrollmentError}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PopupQrCode({ qrDataUrl, hint }: { qrDataUrl: string; hint: string }) {
  return (
    <div className="popup-qr-stack">
      <div className="popup-qr-frame">
        <img
          src={qrDataUrl}
          alt="Scan this QR code with the Volt mobile app"
          className="popup-qr-image"
        />
      </div>
      <p>{hint}</p>
    </div>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Mobile scanner popup root element not found");
}

createRoot(container).render(
  <ExtensionClerkProvider>
    <MobileScannerPopup />
  </ExtensionClerkProvider>,
);
