const SCANNER_SIGNAL_URL = "https://scanner-signal.vercel.app/api/signal";
const SCANNER_APP_PAIR_URL = "volt://pair";
const SCANNER_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
const SCANNER_DATA_CHANNEL = "barcodes";
const SCANNER_ICE_GATHERING_TIMEOUT_MS = 5000;
const SCANNER_ANSWER_POLL_INTERVAL_MS = 1000;

type ScannerState = {
  status: "disconnected" | "creating" | "waiting" | "connected" | "error";
  qrCodeUrl: string | null;
  error: string | null;
};

type BarcodeMessage = {
  barcode: string;
  format?: string;
  kind?: "barcode" | "text";
  scannedAt?: string;
};

function decodeBarcodeMessage(data: string): BarcodeMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed.barcode !== "string" || !parsed.barcode) {
      return null;
    }

    return {
      barcode: parsed.barcode,
      format: typeof parsed.format === "string" ? parsed.format : undefined,
      kind: parsed.kind === "text" ? "text" : "barcode",
      scannedAt: typeof parsed.scannedAt === "string" ? parsed.scannedAt : undefined,
    };
  } catch (_e) {
    return null;
  }
}

class MobileScannerOffscreenSession {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private answerPoll: number | null = null;
  private restartTimer: number | null = null;
  private sessionId: string | null = null;
  private intentionallyClosing = false;
  private recentMessages = new Map<string, number>();
  private state: ScannerState = {
    status: "disconnected",
    qrCodeUrl: null,
    error: null,
  };

  getState() {
    return { ...this.state };
  }

  private setState(patch: Partial<ScannerState>) {
    this.state = { ...this.state, ...patch };
    void chrome.runtime.sendMessage({
      action: "scannerStateChanged",
      source: "scanner-offscreen",
      state: this.getState(),
    });
  }

  async start(force = false) {
    if (
      !force &&
      (this.state.status === "creating" ||
        this.state.status === "waiting" ||
        this.state.status === "connected")
    ) {
      return this.getState();
    }

    this.cleanup(true);
    this.setState({ status: "creating", error: null, qrCodeUrl: null });

    try {
      const pc = new RTCPeerConnection({ iceServers: SCANNER_ICE_SERVERS });
      this.peerConnection = pc;

      const dataChannel = pc.createDataChannel(SCANNER_DATA_CHANNEL, {
        ordered: true,
      });
      this.dataChannel = dataChannel;

      dataChannel.onopen = () => this.setState({ status: "connected", error: null });
      dataChannel.onclose = () => this.restartPairingSoon();
      dataChannel.onerror = () => {
        this.setState({ status: "error", error: "Connection error" });
      };
      dataChannel.onmessage = (event) => {
        const data = decodeBarcodeMessage(String(event.data));
        if (!data || this.isDuplicateMessage(data)) return;
        void chrome.runtime.sendMessage({
          action: "scannerOffscreenScan",
          scan: {
            ...data,
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            scannedAt: data.scannedAt || new Date().toISOString(),
          },
        });
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
      this.setState({
        status: "waiting",
        qrCodeUrl: appPairingUrl,
        error: null,
      });
      this.pollForAnswer(sessionId);
    } catch (err) {
      this.setState({
        status: "error",
        error: err instanceof Error ? err.message : "Failed to start session",
      });
    }

    return this.getState();
  }

  disconnect() {
    this.sessionId = null;
    this.cleanup(true);
    this.setState({ status: "disconnected", qrCodeUrl: null, error: null });
    return this.getState();
  }

  private cleanup(intentional = true) {
    this.intentionallyClosing = intentional;
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.answerPoll) {
      window.clearInterval(this.answerPoll);
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
    this.setState({ status: "creating", error: null, qrCodeUrl: null });
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      this.cleanup(true);
      void this.start(true);
    }, 500);
  }

  private isDuplicateMessage(message: BarcodeMessage) {
    const now = Date.now();
    const key = [
      message.kind || "barcode",
      message.format || "",
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
    if (this.sessionId) {
      try {
        return await this.postSignalingOffer(
          `${SCANNER_SIGNAL_URL}/${encodeURIComponent(this.sessionId)}`,
          localDescription
        );
      } catch (error) {
        console.warn("Failed to refresh scanner pairing session; creating a new one", error);
        this.sessionId = null;
      }
    }

    return this.postSignalingOffer(SCANNER_SIGNAL_URL, localDescription);
  }

  private async postSignalingOffer(
    sessionUrl: string,
    localDescription: RTCSessionDescription
  ) {
    const sessionResponse = await fetch(sessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer: JSON.stringify(localDescription) }),
    });

    if (!sessionResponse.ok) {
      let details = "";
      try {
        const payload = await sessionResponse.json();
        details =
          typeof payload?.error === "string" && payload.error
            ? `: ${payload.error}`
            : "";
      } catch (_error) {}
      throw new Error(
        `Failed to create pairing session (${sessionResponse.status})${details}`
      );
    }

    const { sessionId } = await sessionResponse.json();
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Invalid pairing session");
    }
    return sessionId;
  }

  private pollForAnswer(sessionId: string) {
    this.answerPoll = window.setInterval(async () => {
      try {
        const answerResponse = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}/answer`);
        if (!answerResponse.ok) return;

        const { answer } = await answerResponse.json();
        if (typeof answer !== "string" || !answer || !this.peerConnection) {
          return;
        }

        await this.peerConnection.setRemoteDescription(JSON.parse(answer));
        this.setState({ status: "connected", error: null });

        if (this.answerPoll) {
          window.clearInterval(this.answerPoll);
          this.answerPoll = null;
        }
      } catch (err) {
        console.error("Failed to apply scanner answer", err);
      }
    }, SCANNER_ANSWER_POLL_INTERVAL_MS);
  }
}

const mobileScannerSession = new MobileScannerOffscreenSession();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "scannerOffscreenPing") {
    sendResponse({ ready: true });
    return false;
  }

  if (message.action === "scannerOffscreenStart") {
    mobileScannerSession
      .start()
      .then((state) => sendResponse(state))
      .catch((err) =>
        sendResponse({
          status: "error",
          qrCodeUrl: null,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    return true;
  }

  if (message.action === "scannerOffscreenDisconnect") {
    sendResponse(mobileScannerSession.disconnect());
    return false;
  }

  if (message.action === "scannerOffscreenGetState") {
    sendResponse(mobileScannerSession.getState());
    return false;
  }

  if (message.action === "checkGamepads") {
    try {
      const gamepads = navigator.getGamepads?.() || [];
      let connectedCount = 0;
      let controllerInfo = null;

      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          connectedCount++;
          if (!controllerInfo) {
            controllerInfo = {
              index: i,
              id: gamepads[i]?.id,
              mapping: gamepads[i]?.mapping,
            };
          }
        }
      }

      sendResponse({
        success: true,
        data: {
          connectedCount,
          controllerInfo,
        },
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }

  if (message.action === "copyToClipboard") {
    try {
      const text = message.text;
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (!successful) {
        navigator.clipboard
          .writeText(text)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }

  if (message.action === "readFromClipboard") {
    try {
      const textArea = document.createElement("textarea");
      document.body.appendChild(textArea);
      textArea.focus();
      const successful = document.execCommand("paste");
      const text = textArea.value;
      document.body.removeChild(textArea);
      if (!successful && !text) {
        navigator.clipboard
          .readText()
          .then((clipboardText) => sendResponse({ success: true, text: clipboardText }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }
      sendResponse({ success: true, text });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }

  return false;
});

window.addEventListener("gamepadconnected", (event) => {
  void chrome.runtime.sendMessage({
    action: "gamepadConnected",
    gamepad: {
      index: event.gamepad.index,
      id: event.gamepad.id,
      mapping: event.gamepad.mapping,
    },
  });
});

window.addEventListener("gamepaddisconnected", (event) => {
  void chrome.runtime.sendMessage({
    action: "gamepadDisconnected",
    gamepad: {
      index: event.gamepad.index,
      id: event.gamepad.id,
    },
  });
});
