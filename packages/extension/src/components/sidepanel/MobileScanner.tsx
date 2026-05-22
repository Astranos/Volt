import React, { useEffect, useState, useCallback } from "react";
import {
  CheckCircle,
  Copy,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  XCircle,
} from "lucide-react";
import QRCode from "qrcode";
import { Button } from "../ui/button";
import type {
  BarcodeMessage,
  ScannerConnectionStatus,
} from "../../../../scanner-protocol/src";

const STORAGE_KEY = "volt.mobileScanner.scans";
const MAX_SCANS = 100;

type MobileScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
};

function installEditableTracker() {
  const root = window as typeof window & {
    __voltLastEditable?: HTMLElement | null;
    __voltEditableTrackerInstalled?: boolean;
  };

  const isEditable = (element: Element | null): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    return (
      element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.isContentEditable
    );
  };

  if (isEditable(document.activeElement)) {
    root.__voltLastEditable = document.activeElement;
  }

  if (root.__voltEditableTrackerInstalled) return;

  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      const editableTarget = target instanceof Element ? target : null;
      if (isEditable(editableTarget)) {
        root.__voltLastEditable = editableTarget;
      }
    },
    true
  );
  root.__voltEditableTrackerInstalled = true;
}

type ScanRecord = BarcodeMessage & {
  id: string;
  copied?: boolean;
};

interface MobileScannerProps {
  onClose?: () => void;
}

export default function MobileScanner({ onClose }: MobileScannerProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScannerConnectionStatus>("disconnected");
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const generateQrCode = useCallback(async (url: string) => {
    return QRCode.toDataURL(url, {
      width: 768,
      margin: 3,
      errorCorrectionLevel: "H",
      color: {
        dark: "#05070a",
        light: "#ffffff",
      },
    });
  }, []);

  const persistScans = useCallback((nextScans: ScanRecord[]) => {
    void chrome.storage.local.set({ [STORAGE_KEY]: nextScans });
  }, []);

  const applyScannerState = useCallback(
    (state: Partial<MobileScannerState> | null | undefined) => {
      if (!state) return;
      if (state.status) setStatus(state.status);
      setError(state.error ?? null);

      if (!state.qrCodeUrl) {
        setQrDataUrl(null);
        return;
      }

      void generateQrCode(state.qrCodeUrl).then(setQrDataUrl);
    },
    [generateQrCode]
  );

  const addScan = useCallback(
    (message: BarcodeMessage) => {
      const scan: ScanRecord = {
        ...message,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: message.kind ?? "barcode",
        scannedAt: message.scannedAt ?? new Date().toISOString(),
      };

      setScans((current) => [scan, ...current].slice(0, MAX_SCANS));
    },
    []
  );

  const primeCursorTarget = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: installEditableTracker,
      });
    } catch (_err) {
      // The active tab may be a restricted Chrome page; dictation will fall back to clipboard.
    }
  }, []);

  const startSession = useCallback(async () => {
    setStatus("creating");
    setError(null);
    const response = await chrome.runtime.sendMessage({ action: "scannerStart" });
    if (response?.state) applyScannerState(response.state);
    if (response?.error) {
      setStatus("error");
      setError(response.error);
    }
  }, [applyScannerState]);

  const unpair = useCallback(() => {
    void chrome.runtime
      .sendMessage({ action: "scannerDisconnect" })
      .then((response) => {
        if (response?.state) applyScannerState(response.state);
      });
  }, [applyScannerState]);

  const copyScan = useCallback(async (scan: ScanRecord) => {
    await navigator.clipboard.writeText(scan.barcode);
    setScans((current) =>
      current.map((item) => (item.id === scan.id ? { ...item, copied: true } : item))
    );
  }, []);

  const clearScans = useCallback(() => {
    setScans([]);
    persistScans([]);
  }, [persistScans]);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY).then((stored) => {
      const saved = stored[STORAGE_KEY];
      if (Array.isArray(saved)) setScans(saved);
    });

    void primeCursorTarget();
    void chrome.runtime
      .sendMessage({ action: "scannerGetState" })
      .then((response) => {
        const state = response?.state as MobileScannerState | undefined;
        applyScannerState(state);
        if (!state || state.status === "disconnected" || state.status === "error") {
          void startSession();
        }
      })
      .catch(() => {
        void startSession();
      });
  }, [applyScannerState, primeCursorTarget, startSession]);

  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message?.action === "scannerStateChanged") {
        applyScannerState(message.state);
      } else if (message?.action === "scannerScan") {
        addScan(message.scan);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [addScan, applyScannerState]);

  const scanCount = scans.length;
  const showQr = status === "waiting" && qrDataUrl;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 text-center">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <Smartphone className="h-5 w-5" />
          Mobile Scanner
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Pair the Volt app once per browser sidepanel
        </p>
      </div>

      <div className="mb-4 flex items-center justify-center gap-2">
        {status === "creating" && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-sm text-blue-500">Setting up...</span>
          </>
        )}
        {status === "waiting" && (
          <>
            <QrCode className="h-4 w-4 text-yellow-500" />
            <span className="text-sm text-yellow-500">Waiting for Volt app</span>
          </>
        )}
        {status === "connected" && (
          <>
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm text-green-500">Connected</span>
          </>
        )}
        {status === "disconnected" && (
          <>
            <XCircle className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-500">Disconnected</span>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm text-red-500">{error}</span>
          </>
        )}
      </div>

      <div className="flex flex-col items-center">
        {showQr ? (
          <div className="relative w-full max-w-[320px] rounded-lg bg-white p-4 shadow-lg">
            <img
              src={qrDataUrl}
              alt="Scan this QR code to pair the Volt mobile app"
              className="aspect-square w-full"
            />
            <div className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
              <img
                src={chrome.runtime.getURL("/assets/icons/logo-128.png")}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        ) : status === "creating" ? (
          <div className="flex aspect-square w-full max-w-[320px] items-center justify-center rounded-lg bg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        {status === "waiting" && (
          <p className="mt-3 max-w-[320px] text-center text-xs text-muted-foreground">
            Scan this QR with the phone Camera app to open Volt and pair.
          </p>
        )}
      </div>

      <div className="mt-3">
        {status === "connected" ? (
          <Button onClick={unpair} variant="outline" className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Disconnect
          </Button>
        ) : (status === "error" || status === "disconnected") && (
          <Button onClick={startSession} variant="outline" className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Restart Pairing
          </Button>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Scanned results</div>
          <div className="text-xs text-muted-foreground">{scanCount} saved for this browser</div>
        </div>
        <Button variant="ghost" size="sm" onClick={clearScans} disabled={!scanCount}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {scans.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Scan a barcode or send text from the Volt app. Each result appears here as a one-click copy button.
          </div>
        ) : (
          scans.map((scan) => (
            <div key={scan.id} className="rounded-lg border bg-card p-3">
              <div className="mb-2 min-w-0">
                <div className="truncate font-mono text-sm font-semibold">{scan.barcode}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {scan.kind ?? "barcode"} {scan.format ? `• ${scan.format}` : ""}
                </div>
              </div>
              <div>
                <Button size="sm" className="w-full" onClick={() => copyScan(scan)}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  {scan.copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
