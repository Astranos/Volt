import React, { useEffect, useState, useCallback } from "react";
import {
  Check,
  Copy,
  RefreshCw,
  Scan,
  Smartphone,
  Trash2,
  Images,
  Mic,
  ScanLine,
  TextCursorInput,
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
  ocr: "Text OCR",
  barcode: "Barcode",
  dictation: "Dictation",
  photo: "Photos",
};

const MODE_OPTIONS: Array<{
  value: MobileCaptureMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: "ocr",
    label: "Text",
    description: "OCR",
    icon: TextCursorInput,
  },
  {
    value: "barcode",
    label: "Code",
    description: "UPC",
    icon: ScanLine,
  },
  {
    value: "dictation",
    label: "Voice",
    description: "Speak",
    icon: Mic,
  },
  {
    value: "photo",
    label: "Photos",
    description: "Upload",
    icon: Images,
  },
];

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

  const describeEditable = (element: HTMLElement) => {
    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("placeholder") ||
      element.getAttribute("name") ||
      element.getAttribute("id") ||
      (element.tagName === "TEXTAREA" ? "Textarea" : element.isContentEditable ? "Editable text" : "Text input");
    return String(label).slice(0, 120);
  };

  const notifyTarget = (element: HTMLElement) => {
    try {
      chrome.runtime.sendMessage({
        action: "mobileCursorTargetChanged",
        target: {
          browser: "Chrome",
          tabTitle: document.title || "Current tab",
          url: location.href,
          cursor: describeEditable(element),
        },
      });
    } catch (_error) {}
  };

  if (isEditable(document.activeElement)) {
    root.__voltLastEditable = document.activeElement;
    notifyTarget(document.activeElement);
  }

  if (root.__voltEditableTrackerInstalled) return;

  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      const editableTarget = target instanceof Element ? target : null;
      if (isEditable(editableTarget)) {
        root.__voltLastEditable = editableTarget;
        notifyTarget(editableTarget);
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
    async (force = false, nextMode = mode) => {
      setStatus("creating");
      setError(null);
      const response = await chrome.runtime.sendMessage({
        action: nextMode ? "scannerStartForMode" : "scannerStart",
        force,
        mode: nextMode,
      });
      if (response?.state) applyScannerState(response.state);
      if (response?.error) {
        setStatus("error");
        setError(response.error);
      }
    },
    [applyScannerState, mode]
  );

  const selectMode = useCallback(
    (nextMode: MobileCaptureMode) => {
      const nextTab = nextMode === "photo" ? "photos" : "scans";
      if (mode === nextMode && activeTab === nextTab) return;
      setMode(nextMode);
      setActiveTab(nextTab);
      void startSession(true, nextMode);
    },
    [activeTab, mode, startSession]
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
  const statusCopy = connected
    ? "Ready for App Clip captures"
    : showQr
      ? "Scan QR with iPhone Camera"
      : isCreating
        ? "Preparing pairing"
        : error ?? "Pair iPhone to begin";

  return (
    <div className="sidepanel-shell flex h-full flex-col overflow-hidden">
      <MobileToolHeader
        icon={<Smartphone className="h-4 w-4" />}
        title="Volt App Clip"
        subtitle={
          modeLabel
            ? `${modeLabel} capture from iPhone`
            : "Unified mobile scanner"
        }
        status={status}
        error={error}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-1">
        <div className="liquid-glass concentric-xl overflow-hidden p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase text-green-700">
                Mobile scanner
              </div>
              <div className="mt-1 text-xl font-black leading-tight text-stone-950">
                Capture into Chrome
              </div>
              <p className="mt-1 text-xs font-medium leading-5 text-stone-600">
                {statusCopy}
              </p>
            </div>
            <div className="liquid-glass-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-green-700">
              <Smartphone className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-1.5">
            {MODE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => selectMode(option.value)}
                  className={cn(
                    "group flex min-w-0 flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-2.5 text-center transition active:scale-[0.98]",
                    selected
                      ? "bg-stone-950 text-white shadow-lg shadow-stone-950/15"
                      : "liquid-glass-soft text-stone-600 hover:text-stone-950",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="max-w-full truncate text-[11px] font-black">{option.label}</span>
                  <span className={cn("max-w-full truncate text-[9px] font-semibold", selected ? "text-white/65" : "text-stone-400")}>
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {showQr ? (
          <div className="mt-4">
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
          <div className="mt-4 flex justify-center">
            <PairingPlaceholder label="Setting up secure pairing…" />
          </div>
        ) : null}

        <div className="mt-4">
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

        <div className="liquid-glass-soft mt-4 grid grid-cols-2 rounded-[20px] p-1 text-xs font-bold text-stone-600">
          <button
            type="button"
            onClick={() => {
              setActiveTab("scans");
              if (mode === "photo") selectMode("ocr");
            }}
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-[16px] transition",
              activeTab === "scans" ? "bg-white/80 text-stone-950 shadow-sm" : "hover:text-stone-900",
            )}
          >
            <Scan className="h-3.5 w-3.5" />
            Results
          </button>
          <button
            type="button"
            onClick={() => selectMode("photo")}
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-[16px] transition",
              activeTab === "photos" ? "bg-white/80 text-stone-950 shadow-sm" : "hover:text-stone-900",
            )}
          >
            <Images className="h-3.5 w-3.5" />
            Photos
          </button>
        </div>

        {activeTab === "photos" ? (
          <div className="liquid-glass-soft concentric-xl mt-4 p-3">
            <MobilePhotos embedded showConnectionControls={false} />
          </div>
        ) : (
          <>
        <div className="mt-5 flex items-center justify-between">
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
            <div className="liquid-glass-soft concentric-lg flex flex-col items-center border-dashed border-stone-300 px-4 py-9 text-center">
              <div className="liquid-glass-soft mb-3 flex h-12 w-12 items-center justify-center rounded-full text-stone-400">
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
    <div className="liquid-glass-soft concentric-lg p-3">
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
