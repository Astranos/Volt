import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  CheckCircle,
  Copy,
  Keyboard,
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
  SCANNER_APP_PAIR_URL,
  SCANNER_DATA_CHANNEL,
  SCANNER_ICE_GATHERING_TIMEOUT_MS,
  SCANNER_ICE_SERVERS,
  decodePairingPayload,
  encodePairingPayload,
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
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScannerConnectionStatus>("disconnected");
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [answerCode, setAnswerCode] = useState("");
  const [answerApplied, setAnswerApplied] = useState(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  const generateQrCode = useCallback(async (url: string) => {
    return QRCode.toDataURL(url, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: "M",
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

  const cleanup = useCallback(() => {
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current = null;
  }, []);

  const startSession = useCallback(async () => {
    cleanup();
    setStatus("creating");
    setError(null);
    setQrDataUrl(null);
    setPairingUrl(null);
    setAnswerCode("");
    setAnswerApplied(false);

    try {
      const pc = new RTCPeerConnection({ iceServers: SCANNER_ICE_SERVERS });
      peerConnectionRef.current = pc;

      const dataChannel = pc.createDataChannel(SCANNER_DATA_CHANNEL, { ordered: true });
      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => setStatus("connected");
      dataChannel.onclose = () => setStatus("disconnected");
      dataChannel.onerror = () => {
        setStatus("error");
        setError("Connection error");
      };
      dataChannel.onmessage = (event) => {
        const data = decodeBarcodeMessage(event.data);
        if (data) addScan(data);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setStatus("error");
          setError("Connection failed");
        } else if (pc.connectionState === "disconnected") {
          setStatus("disconnected");
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

      const offerCode = encodePairingPayload(pc.localDescription);
      const url = `${SCANNER_APP_PAIR_URL}?offer=${encodeURIComponent(offerCode)}`;
      setPairingUrl(url);
      setQrDataUrl(await generateQrCode(url));
      setStatus("waiting");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to start session");
    }
  }, [addScan, cleanup, generateQrCode]);

  const applyAnswer = useCallback(async () => {
    const trimmed = answerCode.trim();
    if (!trimmed || !peerConnectionRef.current) return;

    try {
      await peerConnectionRef.current.setRemoteDescription(decodePairingPayload(trimmed));
      setAnswerApplied(true);
      setError(null);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Invalid answer code");
    }
  }, [answerCode]);

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

  const copyPairingUrl = () => {
    if (pairingUrl) navigator.clipboard.writeText(pairingUrl);
  };

  const scanCount = scans.length;

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
            <span className="text-sm text-yellow-500">Scan with Volt app</span>
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
        {qrDataUrl ? (
          <div className="rounded-lg bg-white p-4 shadow-lg">
            <img src={qrDataUrl} alt="Scan this QR code with the Volt mobile app" className="h-48 w-48" />
          </div>
        ) : status === "creating" ? (
          <div className="flex h-48 w-48 items-center justify-center rounded-lg bg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        {pairingUrl && status === "waiting" && (
          <Button variant="ghost" size="sm" className="mt-2 text-xs text-muted-foreground" onClick={copyPairingUrl}>
            <Copy className="mr-1 h-3 w-3" />
            Copy app pairing link
          </Button>
        )}
      </div>

      {status === "waiting" && (
        <div className="mt-4 space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Paste answer code from Volt app
          </label>
          <textarea
            value={answerCode}
            onChange={(event) => setAnswerCode(event.target.value)}
            placeholder="Answer code"
            className="min-h-20 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
            spellCheck={false}
          />
          <Button onClick={applyAnswer} disabled={!answerCode.trim() || answerApplied} className="w-full">
            {answerApplied ? "Answer Applied" : "Connect Phone"}
          </Button>
        </div>
      )}

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
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={() => copyScan(scan)}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  {scan.copied ? "Copied" : "Copy"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => typeAtCursor(scan.barcode)}>
                  <Keyboard className="mr-2 h-3.5 w-3.5" />
                  Type
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {(status === "error" || status === "disconnected" || status === "connected") && (
        <Button onClick={startSession} variant="outline" className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          {status === "connected" ? "New Pairing" : "Restart Pairing"}
        </Button>
      )}
    </div>
  );
}
