import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  decodePairingPayload,
  encodePairingPayload,
  encodeBarcodeMessage,
  SCANNER_ICE_GATHERING_TIMEOUT_MS,
  SCANNER_ICE_SERVERS,
  SCANNER_LOCAL_SESSION_ID,
  SCANNER_SCAN_COOLDOWN_MS,
} from "../../../../../packages/scanner-protocol/src";

export const Route = createFileRoute("/scan/$sessionId")({
  component: ScannerPage,
});

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

function ScannerPage() {
  const { sessionId } = Route.useParams();
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [cameraReady, setCameraReady] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [answerCode, setAnswerCode] = useState<string | null>(null);
  const [answerCopied, setAnswerCopied] = useState(false);
  const [scanCount, setScanCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const html5QrCodeRef = useRef<any>(null);
  const lastScanTimeRef = useRef<number>(0);

  // Send barcode over WebRTC data channel
  const sendBarcode = useCallback((barcode: string, format: string) => {
    if (dataChannelRef.current?.readyState === "open") {
      dataChannelRef.current.send(encodeBarcodeMessage({ barcode, format }));
      setLastScanned(barcode);
      setScanCount((c) => c + 1);
      // Vibrate on success
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
      return true;
    }
    return false;
  }, []);

  // Initialize WebRTC connection
  useEffect(() => {
    let mounted = true;

    async function initWebRTC() {
      try {
        let offerDescription: RTCSessionDescriptionInit;

        if (sessionId === SCANNER_LOCAL_SESSION_ID) {
          const offer = new URLSearchParams(window.location.hash.slice(1)).get("offer");
          if (!offer) {
            throw new Error("Missing QR pairing offer");
          }
          offerDescription = decodePairingPayload(offer);
        } else {
          // Backward-compatible hosted signaling path.
          const offerRes = await fetch(`/api/signal/${sessionId}`);
          if (!offerRes.ok) {
            throw new Error("Session not found or expired");
          }
          const { offer } = await offerRes.json();
          offerDescription = JSON.parse(offer);
        }

        // Create peer connection
        const pc = new RTCPeerConnection({
          iceServers: SCANNER_ICE_SERVERS,
        });
        peerConnectionRef.current = pc;

        // Handle incoming data channel
        pc.ondatachannel = (event) => {
          const channel = event.channel;
          dataChannelRef.current = channel;

          channel.onopen = () => {
            if (mounted) setConnectionStatus("connected");
          };

          channel.onclose = () => {
            if (mounted) setConnectionStatus("disconnected");
          };

          channel.onerror = () => {
            if (mounted) {
              setConnectionStatus("error");
              setErrorMessage("Connection lost");
            }
          };
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            if (mounted) {
              setConnectionStatus("disconnected");
            }
          }
        };

        // Set remote description (the offer)
        await pc.setRemoteDescription(offerDescription);

        // Create and set local description (the answer)
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Wait for ICE gathering to complete
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") {
            resolve();
          } else {
            pc.onicegatheringstatechange = () => {
              if (pc.iceGatheringState === "complete") {
                pc.onicegatheringstatechange = null;
                resolve();
              }
            };
            setTimeout(resolve, SCANNER_ICE_GATHERING_TIMEOUT_MS);
          }
        });

        if (!pc.localDescription) {
          throw new Error("Failed to create answer");
        }

        if (sessionId === SCANNER_LOCAL_SESSION_ID) {
          if (mounted) setAnswerCode(encodePairingPayload(pc.localDescription));
        } else {
          // Send answer to signaling server
          const answerRes = await fetch(`/api/signal/${sessionId}/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer: JSON.stringify(pc.localDescription) }),
          });

          if (!answerRes.ok) {
            throw new Error("Failed to send answer");
          }
        }
      } catch (err) {
        console.error("WebRTC init error:", err);
        if (mounted) {
          setConnectionStatus("error");
          setErrorMessage(err instanceof Error ? err.message : "Connection failed");
        }
      }
    }

    initWebRTC();

    return () => {
      mounted = false;
      peerConnectionRef.current?.close();
    };
  }, [sessionId]);

  const copyAnswer = useCallback(async () => {
    if (!answerCode) return;

    try {
      await navigator.clipboard.writeText(answerCode);
      setAnswerCopied(true);
    } catch (_err) {
      setAnswerCopied(false);
    }
  }, [answerCode]);

  // Initialize camera and barcode scanner
  useEffect(() => {
    if (connectionStatus !== "connected") return;

    let mounted = true;

    async function initCamera() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");

        if (!mounted) return;

        const html5QrCode = new Html5Qrcode("scanner-viewport");
        html5QrCodeRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 280, height: 280 },
            aspectRatio: 1.0,
          },
          (decodedText, decodedResult) => {
            // Debounce scans (2 second cooldown for same barcode)
            const now = Date.now();
            if (decodedText === lastScanTimeRef.current.toString()) return;
            if (now - lastScanTimeRef.current < SCANNER_SCAN_COOLDOWN_MS) return;

            lastScanTimeRef.current = now;
            const format = decodedResult.result.format?.formatName || "unknown";
            sendBarcode(decodedText, format);
          },
          () => {} // Ignore scan errors
        );

        // Get the video track for flashlight control
        const videoElement = document.querySelector("#scanner-viewport video") as HTMLVideoElement;
        if (videoElement?.srcObject) {
          streamRef.current = videoElement.srcObject as MediaStream;
        }

        if (mounted) {
          setCameraReady(true);
        }
      } catch (err) {
        console.error("Camera init error:", err);
        if (mounted) {
          setErrorMessage(err instanceof Error ? err.message : "Camera failed");
        }
      }
    }

    initCamera();

    return () => {
      mounted = false;
      html5QrCodeRef.current?.stop().catch(() => {});
    };
  }, [connectionStatus, sendBarcode]);

  // Toggle flashlight
  const toggleFlash = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;

    try {
      const capabilities = track.getCapabilities() as any;
      if (capabilities.torch) {
        const newFlashState = !flashOn;
        await track.applyConstraints({
          advanced: [{ torch: newFlashState } as any],
        });
        setFlashOn(newFlashState);
      }
    } catch (err) {
      console.error("Flash toggle failed:", err);
    }
  }, [flashOn]);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0a0a0a",
        color: "white",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0.75rem 1rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #333",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>⚡ Volt Scanner</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor:
                  connectionStatus === "connected" ? "#22c55e" :
                  connectionStatus === "connecting" ? "#eab308" : "#ef4444",
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "#888" }}>
              {connectionStatus === "connected" ? "Connected to desktop" :
               connectionStatus === "connecting" ? "Connecting..." : "Disconnected"}
            </span>
          </div>
        </div>
        {scanCount > 0 && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#22c55e" }}>{scanCount}</div>
            <div style={{ fontSize: "0.625rem", color: "#666", textTransform: "uppercase" }}>scans</div>
          </div>
        )}
      </div>

      {/* Scanner viewport */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          position: "relative",
        }}
      >
        {answerCode && connectionStatus !== "connected" ? (
          <div
            style={{
              width: "100%",
              maxWidth: "400px",
              borderRadius: "16px",
              backgroundColor: "#1a1a1a",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              border: "2px solid #333",
              padding: "1rem",
            }}
          >
            <p style={{ color: "#ddd", fontWeight: 600 }}>Finish pairing on desktop</p>
            <p style={{ color: "#888", fontSize: "0.875rem", lineHeight: 1.4 }}>
              Copy this answer code, paste it into the Scout extension, then tap Connect Phone.
            </p>
            <textarea
              readOnly
              value={answerCode}
              style={{
                minHeight: "120px",
                resize: "none",
                borderRadius: "8px",
                border: "1px solid #444",
                backgroundColor: "#0a0a0a",
                color: "#e5e5e5",
                padding: "0.75rem",
                fontFamily: "monospace",
                fontSize: "0.75rem",
              }}
            />
            <button
              onClick={copyAnswer}
              style={{
                padding: "0.875rem 1rem",
                backgroundColor: "#22c55e",
                border: "none",
                borderRadius: "8px",
                color: "#07110a",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {answerCopied ? "Copied" : "Copy Answer Code"}
            </button>
          </div>
        ) : connectionStatus === "connected" ? (
          <div
            id="scanner-viewport"
            style={{
              width: "100%",
              maxWidth: "400px",
              borderRadius: "16px",
              overflow: "hidden",
              border: "2px solid #333",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              maxWidth: "400px",
              aspectRatio: "1",
              borderRadius: "16px",
              backgroundColor: "#1a1a1a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: "1rem",
              border: "2px solid #333",
            }}
          >
            {connectionStatus === "connecting" && (
              <>
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    border: "3px solid #333",
                    borderTopColor: "#22c55e",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <p style={{ color: "#888" }}>Connecting to desktop...</p>
              </>
            )}
            {connectionStatus === "error" && (
              <>
                <p style={{ color: "#ef4444", fontSize: "1.25rem" }}>⚠️</p>
                <p style={{ color: "#ef4444" }}>{errorMessage || "Connection failed"}</p>
                <button
                  onClick={() => window.location.reload()}
                  style={{
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#dc2626",
                    border: "none",
                    borderRadius: "8px",
                    color: "white",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              </>
            )}
            {connectionStatus === "disconnected" && (
              <>
                <p style={{ color: "#888" }}>Connection closed</p>
                <button
                  onClick={() => window.location.reload()}
                  style={{
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#333",
                    border: "none",
                    borderRadius: "8px",
                    color: "white",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Reconnect
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      {connectionStatus === "connected" && cameraReady && (
        <div
          style={{
            padding: "1rem",
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            borderTop: "1px solid #333",
          }}
        >
          <button
            onClick={toggleFlash}
            style={{
              padding: "1rem",
              backgroundColor: flashOn ? "#eab308" : "#333",
              border: "none",
              borderRadius: "50%",
              color: flashOn ? "#000" : "#fff",
              cursor: "pointer",
              fontSize: "1.5rem",
              width: "60px",
              height: "60px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Toggle flashlight"
          >
            💡
          </button>
        </div>
      )}

      {/* Last scanned */}
      {lastScanned && (
        <div
          style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#14532d",
            margin: "0 1rem 1rem",
            borderRadius: "8px",
            textAlign: "center",
          }}
        >
          <p style={{ color: "#86efac", fontSize: "0.75rem" }}>Last sent:</p>
          <p style={{ fontFamily: "monospace", fontSize: "1rem", marginTop: "0.25rem" }}>
            {lastScanned}
          </p>
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          padding: "0.5rem 1rem",
          textAlign: "center",
          fontSize: "0.625rem",
          color: "#444",
        }}
      >
        Point camera at barcode • Auto-detects QR, UPC, EAN, Code-128
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
