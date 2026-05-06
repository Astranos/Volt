import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";

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
      dataChannelRef.current.send(JSON.stringify({ barcode, format }));
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
        // Fetch the offer from signaling server
        const offerRes = await fetch(`/api/signal/${sessionId}`);
        if (!offerRes.ok) {
          throw new Error("Session not found or expired");
        }
        const { offer } = await offerRes.json();

        // Create peer connection
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
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
        await pc.setRemoteDescription(JSON.parse(offer));

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
                resolve();
              }
            };
          }
        });

        // Send answer to signaling server
        const answerRes = await fetch(`/api/signal/${sessionId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: JSON.stringify(pc.localDescription) }),
        });

        if (!answerRes.ok) {
          throw new Error("Failed to send answer");
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
            if (now - lastScanTimeRef.current < 500) return; // General cooldown

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
        {connectionStatus === "connected" ? (
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
