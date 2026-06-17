import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckCircle2, Copy, Loader2, Pencil, RefreshCw, Smartphone, X } from "lucide-react";
import QRCode from "qrcode";
import type { ScannerConnectionStatus } from "../../../scanner-protocol/src";
import {
  PrimaryActionButton,
  SecondaryActionButton,
} from "../../src/components/sidepanel/mobile-shared";
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
  const [copied, setCopied] = useState(false);
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

  const copyLink = useCallback(async () => {
    if (!state.qrCodeUrl) return;
    await navigator.clipboard.writeText(state.qrCodeUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [state.qrCodeUrl]);

  const title = state.status === "connected" ? "iPhone connected" : "Pair iPhone";
  const activeMode = state.mode ?? requestedMode;
  const subtitle = activeMode ? modeLabels[activeMode] : "Mobile scanner";
  const isCreating = state.status === "creating";
  const showQr = Boolean(qrDataUrl) && (state.status === "waiting" || state.status === "connected");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-950">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            {state.status === "connected" ? <CheckCircle2 className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{title}</div>
            <div className="truncate text-xs font-medium text-stone-500">{subtitle}</div>
          </div>
        </div>
        <PopupStatus status={state.status} />
      </header>

      <section className="flex flex-none flex-col gap-1 border-b border-stone-200 bg-white px-5 py-2">
        <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-stone-500">
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
          className="h-9 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-900 outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-500/20 disabled:opacity-60"
          placeholder="Chrome session"
          aria-label="Chrome session name"
        />
        <div className="min-h-3 text-[11px] font-medium leading-3 text-stone-500">
          {labelSaved ? "Saved for future QR sessions" : "Reused by this browser profile"}
        </div>
      </section>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-4">
        {showQr && qrDataUrl ? (
          <PopupQrCode qrDataUrl={qrDataUrl} />
        ) : state.status === "connected" ? (
          <div className="flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white">
              <CheckCircle2 className="h-8 w-8" />
            </span>
            <div className="mt-4 text-base font-bold">Connected</div>
            <p className="mt-1 max-w-[260px] text-sm text-stone-500">
              Continue scanning on your phone. Results land in the sidepanel.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-100 text-stone-500">
              {state.status === "error" ? <X className="h-7 w-7" /> : <Loader2 className="h-7 w-7 animate-spin" />}
            </span>
            <div className="mt-4 text-base font-bold">
              {state.status === "error" ? "Could not create QR" : "Preparing QR"}
            </div>
            <p className="mt-1 max-w-[260px] text-sm text-stone-500">
              {state.error ?? "Creating a secure mobile scanner session."}
            </p>
          </div>
        )}
      </main>

      <footer className="flex flex-none gap-2 border-t border-stone-200 bg-white px-4 py-3">
        <SecondaryActionButton
          onClick={copyLink}
          disabled={!state.qrCodeUrl}
          className="flex-1"
        >
          <Copy className="h-4 w-4" />
          {copied ? "Copied" : "Copy"}
        </SecondaryActionButton>
        <PrimaryActionButton
          onClick={() => startSession(true)}
          disabled={isCreating}
          className="flex-1"
        >
          {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          New QR
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
      ? "bg-green-100 text-green-700"
      : status === "error"
        ? "bg-red-100 text-red-700"
        : status === "waiting"
          ? "bg-amber-100 text-amber-700"
          : "bg-stone-100 text-stone-600";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone}`}>
      {label}
    </span>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Mobile scanner popup root element not found");
}

createRoot(container).render(<MobileScannerPopup />);
