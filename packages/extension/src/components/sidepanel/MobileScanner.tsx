import React, { useEffect, useState, useCallback } from "react";
import {
  Check,
  Copy,
  RefreshCw,
  Scan,
  Smartphone,
  Trash2,
  Images,
} from "lucide-react";
import QRCode from "qrcode";
import { cn } from "../../lib/utils";
import {
  IconChip,
  MobileToolHeader,
  PairingPlaceholder,
  PrimaryActionButton,
  QrPairingPanel,
  SecondaryActionButton,
} from "./mobile-shared";
import MobilePhotos from "./MobilePhotos";
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
  mode: MobileCaptureMode | null;
};

type MobileCaptureMode = "ocr" | "barcode" | "dictation" | "photo";

const MODE_LABELS: Record<MobileCaptureMode, string> = {
  ocr: "OCR Scanning",
  barcode: "Barcode Scanner",
  dictation: "Dictation",
  photo: "Photos",
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

export default function MobileScanner({ onClose: _onClose }: MobileScannerProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScannerConnectionStatus>("disconnected");
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<MobileCaptureMode | null>("ocr");
  const [activeTab, setActiveTab] = useState<"scans" | "photos">("scans");

  const generateQrCode = useCallback(async (url: string) => {
    return QRCode.toDataURL(url, {
      width: 768,
      margin: 3,
      errorCorrectionLevel: "H",
      color: {
        dark: "#1c1917",
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
      if ("mode" in state) setMode(state.mode ?? "ocr");
      setError(state.error ?? null);

      if (!state.qrCodeUrl) {
        setQrDataUrl(null);
        return;
      }

      void generateQrCode(state.qrCodeUrl).then(setQrDataUrl);
    },
    [generateQrCode]
  );

  const addScan = useCallback((message: BarcodeMessage) => {
    const scan: ScanRecord = {
      ...message,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: message.kind ?? "barcode",
      scannedAt: message.scannedAt ?? new Date().toISOString(),
    };

    setScans((current) => [scan, ...current].slice(0, MAX_SCANS));
  }, []);

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

  const startSession = useCallback(
    async (force = false) => {
      setStatus("creating");
      setError(null);
      const response = await chrome.runtime.sendMessage({
        action: mode ? "scannerStartForMode" : "scannerStart",
        force,
        mode,
      });
      if (response?.state) applyScannerState(response.state);
      if (response?.error) {
        setStatus("error");
        setError(response.error);
      }
    },
    [applyScannerState, mode]
  );

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
  const isCreating = status === "creating";
  const connected = status === "connected";
  const modeLabel = mode ? MODE_LABELS[mode] : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <MobileToolHeader
        icon={<Smartphone className="h-4 w-4" />}
        title="Mobile Capture"
        subtitle={
          modeLabel
            ? `Scan with iPhone for ${modeLabel}`
            : "Pair the Volt app once per browser sidepanel"
        }
        status={status}
        error={error}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4">
        {showQr ? (
          <div className="mb-5">
            <QrPairingPanel
              qrDataUrl={qrDataUrl}
              hint={
                modeLabel
                  ? `Scan with the iPhone Camera app for ${modeLabel}.`
                  : "Scan with the phone Camera app to open Volt and pair."
              }
            />
          </div>
        ) : isCreating ? (
          <div className="mb-5 flex justify-center">
            <PairingPlaceholder label="Setting up secure pairing…" />
          </div>
        ) : null}

        <div>
          {connected ? (
            <SecondaryActionButton onClick={unpair} className="w-full">
              <RefreshCw className="h-4 w-4" />
              Disconnect
            </SecondaryActionButton>
          ) : (
            <PrimaryActionButton onClick={() => startSession(true)} className="w-full">
              <RefreshCw className="h-4 w-4" />
              Restart pairing
            </PrimaryActionButton>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 rounded-full bg-stone-100 p-1 text-xs font-bold text-stone-600">
          <button
            type="button"
            onClick={() => setActiveTab("scans")}
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-full transition",
              activeTab === "scans" ? "bg-white text-stone-950 shadow-sm" : "hover:text-stone-900",
            )}
          >
            <Scan className="h-3.5 w-3.5" />
            Text
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("photos")}
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-full transition",
              activeTab === "photos" ? "bg-white text-stone-950 shadow-sm" : "hover:text-stone-900",
            )}
          >
            <Images className="h-3.5 w-3.5" />
            Photos
          </button>
        </div>

        {activeTab === "photos" ? (
          <MobilePhotos embedded />
        ) : (
          <>
        <div className="mt-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-stone-900">Scanned results</div>
            <div className="text-xs text-stone-500">
              {scanCount} saved for this browser
            </div>
          </div>
          <IconChip
            onClick={clearScans}
            disabled={!scanCount}
            aria-label="Clear scanned results"
          >
            <Trash2 className="h-4 w-4" />
          </IconChip>
        </div>

        <div className="mt-3 space-y-2">
          {scans.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-9 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-stone-400 ring-1 ring-stone-200">
                <Scan className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-stone-700">No scans yet</p>
              <p className="mt-1 max-w-[260px] text-xs text-stone-500">
                Scan a barcode, capture text, or dictate from iPhone. Each result appears here as a one-click copy.
              </p>
            </div>
          ) : (
            scans.map((scan) => (
              <ScanCard key={scan.id} scan={scan} onCopy={() => copyScan(scan)} />
            ))
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function ScanCard({ scan, onCopy }: { scan: ScanRecord; onCopy: () => void }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="mb-2 min-w-0">
        <div className="truncate font-mono text-sm font-bold text-stone-900">
          {scan.barcode}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wider text-stone-500">
          <span className="font-semibold text-stone-600">{scan.kind ?? "barcode"}</span>
          {scan.format ? ` · ${scan.format}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          "inline-flex h-9 w-full items-center justify-center gap-2 rounded-full text-xs font-bold transition active:scale-[0.99]",
          scan.copied
            ? "bg-green-50 text-green-700 ring-1 ring-inset ring-green-200"
            : "bg-stone-900 text-stone-50 hover:bg-stone-800",
        )}
      >
        {scan.copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {scan.copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
