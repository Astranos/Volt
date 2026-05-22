import React, { useEffect, useState, useRef, useCallback } from "react";
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
import {
  decodeBarcodeMessage,
  SCANNER_ANSWER_POLL_INTERVAL_MS,
  SCANNER_DATA_CHANNEL,
  SCANNER_ICE_GATHERING_TIMEOUT_MS,
  SCANNER_ICE_SERVERS,
  SCANNER_APP_PAIR_URL,
  SCANNER_SIGNAL_URL,
  type BarcodeMessage,
  type ScannerConnectionStatus,
} from "../../../../scanner-protocol/src";

const STORAGE_KEY = "volt.mobileScanner.scans";
const MAX_SCANS = 100;

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

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const answerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const intentionallyClosingRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);

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

  const addScan = useCallback(
    (message: BarcodeMessage) => {
      const scan: ScanRecord = {
        ...message,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: message.kind ?? "barcode",
        scannedAt: message.scannedAt ?? new Date().toISOString(),
      };

      setScans((current) => {
        const nextScans = [scan, ...current].slice(0, MAX_SCANS);
        persistScans(nextScans);
        return nextScans;
      });
    },
    [persistScans]
  );

  const typeAtCursor = useCallback(async (text: string) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        await navigator.clipboard.writeText(text);
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (value: string) => {
          const activeElement = document.activeElement as HTMLElement | null;

          if (
            activeElement &&
            (activeElement.tagName === "INPUT" ||
              activeElement.tagName === "TEXTAREA" ||
              activeElement.isContentEditable)
          ) {
            if (activeElement.isContentEditable) {
              document.execCommand("insertText", false, value);
            } else {
              const input = activeElement as HTMLInputElement | HTMLTextAreaElement;
              const start = input.selectionStart ?? input.value.length;
              const end = input.selectionEnd ?? input.value.length;
              input.value = input.value.slice(0, start) + value + input.value.slice(end);
              input.selectionStart = input.selectionEnd = start + value.length;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            }
          } else {
            navigator.clipboard.writeText(value).catch(() => {});
          }
        },
        args: [text],
      });
    } catch (_err) {
      await navigator.clipboard.writeText(text);
    }
  }, []);

  const cleanup = useCallback((intentional = true) => {
    intentionallyClosingRef.current = intentional;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (answerPollRef.current) {
      clearInterval(answerPollRef.current);
      answerPollRef.current = null;
    }
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current = null;
    window.setTimeout(() => {
      intentionallyClosingRef.current = false;
    }, 0);
  }, []);

  const restartPairingSoon = useCallback(() => {
    if (intentionallyClosingRef.current || restartTimerRef.current) return;
    setStatus("creating");
    setError(null);
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      void startSessionRef.current?.();
    }, 500);
  }, []);

  const startSession = useCallback(async () => {
    cleanup();
    setStatus("creating");
    setError(null);
    setQrDataUrl(null);

    try {
      const pc = new RTCPeerConnection({ iceServers: SCANNER_ICE_SERVERS });
      peerConnectionRef.current = pc;

      const dataChannel = pc.createDataChannel(SCANNER_DATA_CHANNEL, { ordered: true });
      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => setStatus("connected");
      dataChannel.onclose = () => restartPairingSoon();
      dataChannel.onerror = () => {
        setStatus("error");
        setError("Connection error");
      };
      dataChannel.onmessage = (event) => {
        const data = decodeBarcodeMessage(event.data);
        if (!data) return;
        addScan(data);
        if (data.kind === "text" && data.format === "dictation") {
          void typeAtCursor(data.barcode);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          restartPairingSoon();
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "closed") {
          restartPairingSoon();
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }

        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") {
            pc.onicegatheringstatechange = null;
            resolve();
          }
        };
        setTimeout(resolve, SCANNER_ICE_GATHERING_TIMEOUT_MS);
      });

      if (!pc.localDescription) {
        throw new Error("Failed to create pairing offer");
      }

      const sessionResponse = await fetch(SCANNER_SIGNAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer: JSON.stringify(pc.localDescription) }),
      });

      if (!sessionResponse.ok) {
        throw new Error("Failed to create pairing session");
      }

      const { sessionId } = await sessionResponse.json();
      if (typeof sessionId !== "string" || !sessionId) {
        throw new Error("Invalid pairing session");
      }

      const appPairingUrl = `${SCANNER_APP_PAIR_URL}?session=${encodeURIComponent(sessionId)}`;
      setQrDataUrl(await generateQrCode(appPairingUrl));
      setStatus("waiting");

      answerPollRef.current = setInterval(async () => {
        try {
          const answerResponse = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}/answer`);
          if (!answerResponse.ok) return;

          const { answer } = await answerResponse.json();
          if (typeof answer !== "string" || !answer || !peerConnectionRef.current) return;

          await peerConnectionRef.current.setRemoteDescription(JSON.parse(answer));
          setStatus("connected");
          setError(null);

          if (answerPollRef.current) {
            clearInterval(answerPollRef.current);
            answerPollRef.current = null;
          }
        } catch (err) {
          console.error("Failed to apply scanner answer", err);
        }
      }, SCANNER_ANSWER_POLL_INTERVAL_MS);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to start session");
    }
  }, [addScan, cleanup, generateQrCode, restartPairingSoon, typeAtCursor]);

  useEffect(() => {
    startSessionRef.current = startSession;
  }, [startSession]);

  const unpair = useCallback(() => {
    cleanup();
    void startSession();
  }, [cleanup, startSession]);

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

    startSession();

    return () => cleanup();
  }, [cleanup, startSession]);

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
