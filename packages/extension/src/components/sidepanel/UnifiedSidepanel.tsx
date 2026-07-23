import React, { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import TopOffersPage from "./TopOffers";
import MobileScanner from "./MobileScanner";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Info,
  Loader2,
  QrCode,
  Smartphone,
  X,
  XCircle,
} from "lucide-react";
import type { ScannerConnectionStatus } from "@volt/scanner-protocol";
import { cn } from "../../lib/utils";
import {
  SIDEPANEL_TOOLS,
  isSidepanelToolId,
  type SidepanelToolId,
} from "../../lib/sidepanel-tools";
import {
  SIDEPANEL_TOAST_EVENT,
  type SidepanelToastDetail,
  type SidepanelToastTone,
} from "../../lib/sidepanel-toast";
import {
  getMobileScannerExtensionIdentity,
} from "../../domain/mobile-scanner-session";
import {
  ExtensionAccountControl,
  useSidepanelClerkToken,
} from "../access/ExtensionAccess";

type ActiveToast = {
  message: string;
  tone: SidepanelToastTone;
  id: number;
};

const TOAST_DURATION_MS = 1900;

function objectFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const TOAST_TONE_STYLES: Record<
  SidepanelToastTone,
  { text: string; icon: React.ComponentType<{ className?: string }> }
> = {
  success: {
    text: "text-green-700 dark:text-green-300",
    icon: CheckCircle2,
  },
  info: {
    text: "text-sky-700 dark:text-sky-300",
    icon: Info,
  },
  warning: {
    text: "text-amber-700 dark:text-amber-300",
    icon: AlertTriangle,
  },
  error: {
    text: "text-red-600 dark:text-red-300",
    icon: XCircle,
  },
};

export default function UnifiedSidepanel() {
  const [activeTool, setActiveTool] =
    useState<SidepanelToolId>("mobile-scanner");
  const [scannerStatus, setScannerStatus] =
    useState<ScannerConnectionStatus>("disconnected");
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const toastCounter = useRef(0);
  const windowIdRef = useRef<number | null>(null);
  const closeReportedRef = useRef(false);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SidepanelToastDetail>).detail;
      if (!detail || typeof detail.message !== "string" || !detail.message) {
        return;
      }
      toastCounter.current += 1;
      const id = toastCounter.current;
      const tone: SidepanelToastTone = detail.tone ?? "success";
      setToast({ message: detail.message, tone, id });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => {
        setToast((curr) => (curr && curr.id === id ? null : curr));
        toastTimer.current = null;
      }, TOAST_DURATION_MS);
    };
    window.addEventListener(SIDEPANEL_TOAST_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(
        SIDEPANEL_TOAST_EVENT,
        handler as EventListener,
      );
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime) return;

    chrome.runtime.sendMessage({ action: "scannerGetState" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.state?.status) {
        setScannerStatus(response.state.status as ScannerConnectionStatus);
      }
    });

    const listener = (message: any) => {
      if (message?.action !== "scannerStateChanged") return;
      if (message?.state?.status) {
        setScannerStatus(message.state.status as ScannerConnectionStatus);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined") return;

    chrome.windows?.getCurrent?.((currentWindow) => {
      if (typeof currentWindow?.id === "number") {
        windowIdRef.current = currentWindow.id;
      }
    });

    const reportClosed = () => {
      if (closeReportedRef.current || !chrome.runtime) return;
      closeReportedRef.current = true;
      chrome.runtime.sendMessage(
        {
          action: "sidePanelDidClose",
          windowId: windowIdRef.current ?? undefined,
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    };

    window.addEventListener("pagehide", reportClosed);
    window.addEventListener("beforeunload", reportClosed);

    return () => {
      window.removeEventListener("pagehide", reportClosed);
      window.removeEventListener("beforeunload", reportClosed);
    };
  }, []);

  // Load the initial tool from storage
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(
        { sidePanelTool: "mobile-scanner" },
        (result: { sidePanelTool?: string }) => {
          const storedTool = result.sidePanelTool;
          const tool = storedTool && isSidepanelToolId(storedTool)
            ? storedTool
            : "mobile-scanner";
          setActiveTool(tool);
        }
      );

      // Listen for storage changes to switch tools dynamically
      const handleStorageChange = (changes: any, areaName: string) => {
        if (areaName === "local" && changes.sidePanelTool) {
          const storedTool = changes.sidePanelTool.newValue;
          const newTool = typeof storedTool === "string" &&
            isSidepanelToolId(storedTool)
            ? storedTool
            : "mobile-scanner";
          setActiveTool(newTool);
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);

      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  // Update storage when tool changes
  const handleToolChange = (value: SidepanelToolId) => {
    setActiveTool(value);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ sidePanelTool: value });
    }
  };

  const openMobilePairingPopup = () => {
    if (typeof chrome === "undefined" || !chrome.runtime) return;
    chrome.runtime.sendMessage({
      action: "openMobileCapturePopup",
    });
  };

  const componentMap: Record<
    SidepanelToolId,
    React.ComponentType<{ onClose?: () => void }>
  > = {
    "top-offers": TopOffersPage,
    "mobile-scanner": MobileScanner,
    "mobile-photos": MobileScanner,
  };

  const tools = SIDEPANEL_TOOLS.map((tool) => ({
    ...tool,
    component: componentMap[tool.id],
  }));

  const ActiveComponent =
    tools.find((t) => t.id === activeTool)?.component || MobileScanner;

  const toneStyles = toast ? TOAST_TONE_STYLES[toast.tone] : null;
  const ToastIcon = toneStyles?.icon;

  return (
    <div className="sidepanel-shell sidepanel-frame h-full w-full flex flex-col">
      <div className="sidepanel-content-frame flex flex-1 flex-col overflow-hidden">
        <div className="sidepanel-tool-header">
          <div className="sidepanel-tool-row">
            <div className="sidepanel-tool-tabs" role="tablist" aria-label="Volt tools">
              {SIDEPANEL_TOOLS.map((tool) => {
                const ToolIcon = tool.icon;
                const selected = activeTool === tool.id;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={cn("sidepanel-tool-tab", selected && "is-active")}
                    onClick={() => handleToolChange(tool.id)}
                  >
                    <ToolIcon />
                    <span>{tool.label}</span>
                  </button>
                );
              })}
            </div>
            <ExtensionAccountControl sharedClerkContext />
          </div>

          {activeTool === "mobile-scanner" ? (
            <SidepanelScannerControls
              status={scannerStatus}
              onPair={openMobilePairingPopup}
            />
          ) : null}

          {toast && ToastIcon ? (
            <span
              key={toast.id}
              aria-live="polite"
              className={cn("volt-toast-enter sidepanel-tool-toast", toneStyles?.text)}
            >
              <ToastIcon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{toast.message}</span>
            </span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ActiveComponent
            onClose={() => handleToolChange("mobile-scanner")}
          />
        </div>
      </div>
    </div>
  );
}

function SidepanelScannerControls({
  onPair,
  status,
}: {
  onPair: () => void;
  status: ScannerConnectionStatus;
}) {
  const getClerkToken = useSidepanelClerkToken();
  const [sessionLabel, setSessionLabel] = useState("");
  const [creatingEnrollment, setCreatingEnrollment] = useState(false);
  const [enrollmentQrDataUrl, setEnrollmentQrDataUrl] = useState<string | null>(null);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMobileScannerExtensionIdentity()
      .then((identity) => {
        if (cancelled) return;
        setSessionLabel(identity.sessionLabel);
        void chrome.runtime
          .sendMessage({ action: "scannerUpdateExtensionIdentity", identity })
          .catch(() => undefined);
      })
      .catch(() => {
        if (cancelled) return;
        setSessionLabel("Volt for iPhone");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const createFullAppEnrollment = useCallback(async () => {
    setCreatingEnrollment(true);
    setEnrollmentError(null);
    try {
      const clerkToken = await getClerkToken();
      if (!clerkToken) throw new Error("Sign in to enroll Volt for iPhone.");
      const response: unknown = await chrome.runtime.sendMessage({
        action: "workspaceCreateEnrollment",
        label: sessionLabel || "Volt for iPhone",
        clerkToken,
      });
      const responseRecord = objectFrom(response);
      const value = objectFrom(responseRecord?.value);
      if (responseRecord?.success !== true || typeof value?.enrollmentUrl !== "string") {
        throw new Error(
          typeof responseRecord?.error === "string"
            ? responseRecord.error
            : "Could not create enrollment QR.",
        );
      }
      const qr = await QRCode.toDataURL(value.enrollmentUrl, {
        width: 768,
        margin: 3,
        errorCorrectionLevel: "H",
        color: { dark: "#1c1917", light: "#ffffff" },
      });
      setEnrollmentQrDataUrl(qr);
    } catch (error) {
      setEnrollmentError(
        error instanceof Error ? error.message : "Could not create enrollment QR.",
      );
    } finally {
      setCreatingEnrollment(false);
    }
  }, [getClerkToken, sessionLabel]);

  const closeEnrollment = () => {
    setEnrollmentQrDataUrl(null);
    setEnrollmentError(null);
  };

  return (
    <>
      <div className="sidepanel-scanner-controls">
        <div className="sidepanel-scanner-actions">
          <button
            type="button"
            className="sidepanel-cloud-action"
            onClick={() => void createFullAppEnrollment()}
            disabled={creatingEnrollment}
            aria-label="Connect installed iPhone app"
            title="Connect installed iPhone app for cloud sync"
          >
            {creatingEnrollment ? <Loader2 className="animate-spin" /> : <Cloud />}
            <span>Cloud sync</span>
          </button>
          <SidepanelMobilePairingStatus status={status} onClick={onPair} />
        </div>
      </div>

      {enrollmentQrDataUrl || enrollmentError ? (
        <div
          className="sidepanel-enrollment-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Connect installed Volt app"
        >
          <div className="sidepanel-enrollment-card">
            <button
              type="button"
              className="sidepanel-enrollment-close"
              onClick={closeEnrollment}
              aria-label="Close enrollment QR"
            >
              <X />
            </button>
            <Cloud className="sidepanel-enrollment-icon" />
            <h2>Connect installed iPhone app</h2>
            {enrollmentQrDataUrl ? (
              <>
                <div className="sidepanel-enrollment-qr">
                  <img src={enrollmentQrDataUrl} alt="One-time QR to enroll Volt for iPhone" />
                </div>
                <p>Scan once in the installed Volt app to enable account-wide cloud sync.</p>
              </>
            ) : (
              <p className="sidepanel-enrollment-error">{enrollmentError}</p>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function SidepanelMobilePairingStatus({
  onClick,
  status,
}: {
  onClick: () => void;
  status: ScannerConnectionStatus;
}) {
  const isPaired = status === "connected";
  const isCreating = status === "creating";
  const label = isPaired ? "Connected" : isCreating ? "Connecting" : "Pair phone";
  const Icon = isPaired ? Smartphone : isCreating ? Loader2 : QrCode;
  const tone = isPaired
    ? "is-paired"
    : status === "waiting"
      ? "is-ready"
      : isCreating
        ? "is-creating"
        : "is-inactive";

  return (
    <button
      type="button"
      className={`sidepanel-mobile-status ${tone}`}
      onClick={onClick}
      aria-label="Open mobile pairing"
      title="Open mobile pairing"
    >
      <Icon className={isCreating ? "animate-spin" : undefined} />
      <span>{label}</span>
    </button>
  );
}
