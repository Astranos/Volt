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
} from "../../../scanner-protocol/src";

type SessionTimer = ReturnType<typeof setInterval>;

export type MobileScannerSessionEvents = {
  onQrCodeUrl: (url: string | null) => void;
  onStatus: (status: ScannerConnectionStatus) => void;
  onError: (error: string | null) => void;
  onScan: (message: BarcodeMessage) => void;
  onInsert: (text: string) => void;
};

export function shouldInsertScannerMessage(message: BarcodeMessage) {
  return (
    message.kind === "barcode" ||
    (message.kind === "text" && message.format === "dictation")
  );
}

export class MobileScannerSession {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private answerPoll: SessionTimer | null = null;
  private restartTimer: number | null = null;
  private sessionId: string | null = null;
  private intentionallyClosing = false;
  private recentMessages = new Map<string, number>();

  constructor(private readonly events: MobileScannerSessionEvents) {}

  async start() {
    this.cleanup();
    this.events.onStatus("creating");
    this.events.onError(null);
    this.events.onQrCodeUrl(null);

    try {
      const pc = new RTCPeerConnection({ iceServers: SCANNER_ICE_SERVERS });
      this.peerConnection = pc;

      const dataChannel = pc.createDataChannel(SCANNER_DATA_CHANNEL, {
        ordered: true,
      });
      this.dataChannel = dataChannel;

      dataChannel.onopen = () => this.events.onStatus("connected");
      dataChannel.onclose = () => this.restartPairingSoon();
      dataChannel.onerror = () => {
        this.events.onStatus("error");
        this.events.onError("Connection error");
      };
      dataChannel.onmessage = (event) => {
        const data = decodeBarcodeMessage(event.data);
        if (!data) return;
        if (this.isDuplicateMessage(data)) return;
        this.events.onScan(data);
        if (shouldInsertScannerMessage(data)) {
          this.events.onInsert(data.barcode);
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
          this.restartPairingSoon();
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.waitForIceGathering(pc);

      if (!pc.localDescription) {
        throw new Error("Failed to create pairing offer");
      }

      const sessionId = await this.createSignalingSession(pc.localDescription);
      this.sessionId = sessionId;
      const appPairingUrl = `${SCANNER_APP_PAIR_URL}?session=${encodeURIComponent(sessionId)}`;
      this.events.onQrCodeUrl(appPairingUrl);
      this.events.onStatus("waiting");
      this.pollForAnswer(sessionId);
    } catch (err) {
      this.events.onStatus("error");
      this.events.onError(
        err instanceof Error ? err.message : "Failed to start session"
      );
    }
  }

  unpair() {
    this.sessionId = null;
    this.cleanup();
    void this.start();
  }

  cleanup(intentional = true) {
    this.intentionallyClosing = intentional;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.answerPoll) {
      clearInterval(this.answerPoll);
      this.answerPoll = null;
    }
    this.dataChannel?.close();
    this.peerConnection?.close();
    this.dataChannel = null;
    this.peerConnection = null;
    window.setTimeout(() => {
      this.intentionallyClosing = false;
    }, 0);
  }

  private restartPairingSoon() {
    if (this.intentionallyClosing || this.restartTimer) return;
    this.events.onStatus("creating");
    this.events.onError(null);
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      void this.start();
    }, 500);
  }

  private isDuplicateMessage(message: BarcodeMessage) {
    const now = Date.now();
    const key = [
      message.kind ?? "barcode",
      message.format ?? "",
      message.barcode.trim().toLowerCase(),
    ].join(":");
    const lastSeenAt = this.recentMessages.get(key);

    for (const [recentKey, seenAt] of this.recentMessages) {
      if (now - seenAt > 2500) {
        this.recentMessages.delete(recentKey);
      }
    }

    if (lastSeenAt && now - lastSeenAt < 1500) {
      return true;
    }

    this.recentMessages.set(key, now);
    return false;
  }

  private waitForIceGathering(pc: RTCPeerConnection) {
    return new Promise<void>((resolve) => {
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
  }

  private async createSignalingSession(localDescription: RTCSessionDescription) {
    const sessionUrl = this.sessionId
      ? `${SCANNER_SIGNAL_URL}/${encodeURIComponent(this.sessionId)}`
      : SCANNER_SIGNAL_URL;
    const sessionResponse = await fetch(sessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer: JSON.stringify(localDescription) }),
    });

    if (!sessionResponse.ok) {
      throw new Error("Failed to create pairing session");
    }

    const { sessionId } = await sessionResponse.json();
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Invalid pairing session");
    }
    return sessionId;
  }

  private pollForAnswer(sessionId: string) {
    this.answerPoll = setInterval(async () => {
      try {
        const answerResponse = await fetch(
          `${SCANNER_SIGNAL_URL}/${sessionId}/answer`
        );
        if (!answerResponse.ok) return;

        const { answer } = await answerResponse.json();
        if (
          typeof answer !== "string" ||
          !answer ||
          !this.peerConnection
        ) {
          return;
        }

        await this.peerConnection.setRemoteDescription(JSON.parse(answer));
        this.events.onStatus("connected");
        this.events.onError(null);

        if (this.answerPoll) {
          clearInterval(this.answerPoll);
          this.answerPoll = null;
        }
      } catch (err) {
        console.error("Failed to apply scanner answer", err);
      }
    }, SCANNER_ANSWER_POLL_INTERVAL_MS);
  }
}
