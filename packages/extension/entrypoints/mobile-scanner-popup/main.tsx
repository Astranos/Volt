import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckCircle2, Loader2, Pencil, X } from "lucide-react";
import QRCode from "qrcode";
import type { ScannerConnectionStatus } from "@volt/scanner-protocol";
import {
  getMobileScannerExtensionIdentity,
  saveMobileScannerSessionLabel,
} from "../../src/domain/mobile-scanner-session";
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
};

function normalizeMode(value: string | null): MobileCaptureMode | null {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo"
    ? value
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

  useEffect(() => {
    let cancelled = false;
    void getMobileScannerExtensionIdentity()
      .then((identity) => {
        if (cancelled) return;
        setSessionLabel(identity.sessionLabel);
        setIdentityLoaded(true);
        void chrome.runtime
          .sendMessage({ action: "scannerUpdateExtensionIdentity", identity })
          .catch(() => undefined);
      })
      .catch(() => {
        if (cancelled) return;
        setSessionLabel("Chrome session");
        setIdentityLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveSessionLabel = useCallback(async () => {
    const identity = await saveMobileScannerSessionLabel(sessionLabel);
    setSessionLabel(identity.sessionLabel);
    setLabelSaved(true);
    window.setTimeout(() => setLabelSaved(false), 1000);
    await chrome.runtime
      .sendMessage({ action: "scannerUpdateExtensionIdentity", identity })
      .catch(() => undefined);
  }, [sessionLabel]);

  const applyScannerState = useCallback((nextState: Partial<MobileScannerState> | null | undefined) => {
    if (!nextState) return;
    setState((current) => ({ ...current, ...nextState }));
  }, []);

  const refreshState = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ action: "scannerGetState" });
    applyScannerState(response?.state);
    return response?.state as MobileScannerState | undefined;
  }, [applyScannerState]);

  const startSession = useCallback(async (force = false) => {
    setState((current) => ({ ...current, status: "creating", error: null }));
    const response = await chrome.runtime.sendMessage({
      action: "scannerStartForMode",
      force,
      mode: requestedMode,
    });
    if (response?.state) applyScannerState(response.state);
    if (response?.error) {
      setState((current) => ({ ...current, status: "error", error: response.error }));
    }
  }, [applyScannerState, requestedMode]);

  const ensureJoinWindow = useCallback(async (currentState?: MobileScannerState) => {
    if (isJoinWindowActive(currentState)) return;
    await startSession(false);
  }, [startSession]);

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

  const showQr = Boolean(qrDataUrl) && (state.status === "waiting" || state.status === "connected");
  const pairingHint = state.status === "connected"
    ? "Scan this QR with another phone to add it to this browser session."
    : "Scan this QR with Volt on your phone.";

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
      {showQr && qrDataUrl ? (
        <PopupQrCode qrDataUrl={qrDataUrl} hint={pairingHint} />
      ) : state.status === "connected" ? (
        <div className="popup-message popup-message-success">
          <CheckCircle2 aria-hidden="true" />
          <strong>Phone connected</strong>
        </div>
      ) : (
        <div className="popup-message">
          {state.status === "error" ? <X aria-hidden="true" /> : <Loader2 className="animate-spin" aria-hidden="true" />}
          <strong>{state.status === "error" ? "Could not create QR" : "Preparing QR"}</strong>
          <p>{state.error ?? "Creating a secure pairing code."}</p>
        </div>
      )}
    </main>
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
  <MobileScannerPopup />,
);
