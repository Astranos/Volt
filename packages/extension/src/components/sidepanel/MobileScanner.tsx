import React, { useEffect, useState, useRef, useCallback } from "react";
import { Smartphone, Loader2, CheckCircle, XCircle, Copy, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import {
  decodeBarcodeMessage,
  SCANNER_ANSWER_POLL_INTERVAL_MS,
  SCANNER_DATA_CHANNEL,
  SCANNER_ICE_GATHERING_TIMEOUT_MS,
  SCANNER_ICE_SERVERS,
  SCANNER_WEB_APP_URL,
  type ScannerConnectionStatus,
} from "../../../../scanner-protocol/src";

interface MobileScannerProps {
  onClose?: () => void;
}

export default function MobileScanner({ onClose }: MobileScannerProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScannerConnectionStatus>("disconnected");
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Generate QR code using background script
  const generateQrCode = useCallback(async (url: string) => {
    return new Promise<string>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "generateQr", text: url, size: 256 },
        (response) => {
          if (response?.success && response.dataUrl) {
            resolve(response.dataUrl);
          } else {
            reject(new Error(response?.error || "Failed to generate QR code"));
          }
        }
      );
    });
  }, []);

  // Type barcode at cursor in active tab
  const typeAtCursor = useCallback(async (barcode: string) => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        await navigator.clipboard.writeText(barcode);
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text: string) => {
          const activeElement = document.activeElement as HTMLElement;

          if (
            activeElement &&
            (activeElement.tagName === "INPUT" ||
              activeElement.tagName === "TEXTAREA" ||
              activeElement.isContentEditable)
          ) {
            if (activeElement.isContentEditable) {
              document.execCommand("insertText", false, text);
            } else {
              const input = activeElement as HTMLInputElement | HTMLTextAreaElement;
              const start = input.selectionStart ?? input.value.length;
              const end = input.selectionEnd ?? input.value.length;
              const newValue =
                input.value.slice(0, start) + text + input.value.slice(end);
              input.value = newValue;
              input.selectionStart = input.selectionEnd = start + text.length;

              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            }
          } else {
            navigator.clipboard.writeText(text).catch(() => {});
          }
        },
        args: [barcode],
      });
    } catch (err) {
      await navigator.clipboard.writeText(barcode);
    }
  }, []);

  // Handle incoming barcode from data channel
  const handleBarcode = useCallback((barcode: string) => {
    setLastBarcode(barcode);
    setScanCount((c) => c + 1);
    typeAtCursor(barcode);
  }, [typeAtCursor]);

  // Clean up resources
  const cleanup = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  }, []);

  // Start a new WebRTC session
  const startSession = useCallback(async () => {
    cleanup();
    setStatus("creating");
    setError(null);
    setQrDataUrl(null);
    setSessionId(null);

    try {
      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: SCANNER_ICE_SERVERS,
      });
      peerConnectionRef.current = pc;

      // Create data channel (extension is the offerer)
      const dataChannel = pc.createDataChannel(SCANNER_DATA_CHANNEL, {
        ordered: true,
      });
      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => {
        setStatus("connected");
        // Stop polling for answer once connected
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };

      dataChannel.onclose = () => {
        setStatus("disconnected");
      };

      dataChannel.onerror = () => {
        setStatus("error");
        setError("Connection error");
      };

      dataChannel.onmessage = (event) => {
        const data = decodeBarcodeMessage(event.data);
        if (data) {
          handleBarcode(data.barcode);
        } else {
          console.error("Failed to parse barcode message");
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setStatus("error");
          setError("Connection failed");
        } else if (pc.connectionState === "disconnected") {
          setStatus("disconnected");
        }
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        } else {
          const checkState = () => {
            if (pc.iceGatheringState === "complete") {
              pc.onicegatheringstatechange = null;
              resolve();
            }
          };
          pc.onicegatheringstatechange = checkState;
          // Timeout after 5 seconds
          setTimeout(resolve, SCANNER_ICE_GATHERING_TIMEOUT_MS);
        }
      });

      // Upload offer to signaling server
      const response = await fetch(`${SCANNER_WEB_APP_URL}/api/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer: JSON.stringify(pc.localDescription) }),
      });

      if (!response.ok) {
        throw new Error("Failed to create session");
      }

      const { sessionId: newSessionId } = await response.json();
      setSessionId(newSessionId);

      // Generate QR code
      const scanUrl = `${SCANNER_WEB_APP_URL}/scan/${newSessionId}`;
      const qrUrl = await generateQrCode(scanUrl);
      setQrDataUrl(qrUrl);
      setStatus("waiting");

      // Poll for answer
      pollIntervalRef.current = setInterval(async () => {
        try {
          const answerRes = await fetch(`${SCANNER_WEB_APP_URL}/api/signal/${newSessionId}/answer`);
          if (!answerRes.ok) return;

          const { answer } = await answerRes.json();
          if (answer && peerConnectionRef.current) {
            await peerConnectionRef.current.setRemoteDescription(JSON.parse(answer));
            // Stop polling
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
          }
        } catch (err) {
          // Ignore polling errors
        }
      }, SCANNER_ANSWER_POLL_INTERVAL_MS);

    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to start session");
    }
  }, [cleanup, generateQrCode, handleBarcode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Auto-start session on mount
  useEffect(() => {
    startSession();
  }, []);

  const copyQrUrl = () => {
    if (sessionId) {
      navigator.clipboard.writeText(`${SCANNER_WEB_APP_URL}/scan/${sessionId}`);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      {/* Header */}
      <div className="text-center mb-4">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <Smartphone className="h-5 w-5" />
          Mobile Scanner
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Direct P2P connection • No cloud server
        </p>
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-center gap-2 mb-4">
        {status === "creating" && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-sm text-blue-500">Setting up...</span>
          </>
        )}
        {status === "waiting" && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
            <span className="text-sm text-yellow-500">Scan QR with phone</span>
          </>
        )}
        {status === "connected" && (
          <>
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm text-green-500">Connected • P2P Active</span>
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

      {/* QR Code */}
      <div className="flex flex-col items-center">
        {qrDataUrl ? (
          <div className="bg-white p-4 rounded-lg shadow-lg">
            <img
              src={qrDataUrl}
              alt="Scan this QR code with your phone"
              className="w-48 h-48"
            />
          </div>
        ) : status === "creating" ? (
          <div className="w-48 h-48 bg-muted rounded-lg flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        {sessionId && status === "waiting" && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-xs text-muted-foreground"
            onClick={copyQrUrl}
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy link
          </Button>
        )}
      </div>

      {/* Scan counter when connected */}
      {status === "connected" && (
        <div className="mt-4 text-center">
          <div className="text-4xl font-bold text-green-500">{scanCount}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            barcodes scanned
          </div>
        </div>
      )}

      {/* Instructions */}
      {(status === "waiting" || status === "creating") && (
        <div className="mt-6 space-y-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">How to use:</p>
          <ol className="list-decimal list-inside space-y-2">
            <li>Scan the QR code with your phone camera</li>
            <li>Open the link to connect</li>
            <li>Click on an input field on this computer</li>
            <li>Point your phone at barcodes to scan</li>
          </ol>
        </div>
      )}

      {/* Last scanned */}
      {lastBarcode && (
        <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <p className="text-xs text-green-600 dark:text-green-400 mb-1">
            Last scanned:
          </p>
          <p className="font-mono text-sm">{lastBarcode}</p>
        </div>
      )}

      {/* New session button */}
      {(status === "error" || status === "disconnected" || status === "connected") && (
        <Button onClick={startSession} variant="outline" className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          {status === "connected" ? "New Session" : "Restart"}
        </Button>
      )}
    </div>
  );
}
