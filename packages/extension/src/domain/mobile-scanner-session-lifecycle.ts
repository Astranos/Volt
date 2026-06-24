import type { ScannerConnectionStatus } from "@volt/scanner-protocol";
import type { ExtensionIdentity } from "./mobile-scanner-identity";
import type { JoinWindow } from "./mobile-scanner-signal-client";
import type {
  MobileScannerSessionState,
  SessionTarget,
} from "./mobile-scanner-session-types";

type MobileScannerSessionLifecycleOptions = {
  countConnectedPeers: () => number;
  initialSessionId: string;
  onState: (state: MobileScannerSessionState) => void;
};

export class MobileScannerSessionLifecycle {
  private activeJoinWindow: JoinWindow | null = null;
  private readonly options: MobileScannerSessionLifecycleOptions;
  private state: MobileScannerSessionState;
  private target: SessionTarget | null = null;

  constructor(options: MobileScannerSessionLifecycleOptions) {
    this.options = options;
    this.state = {
      status: "disconnected",
      qrCodeUrl: null,
      error: null,
      connectedAt: null,
      connectedPeerCount: 0,
      joinWindowExpiresAt: null,
      sessionId: options.initialSessionId,
      target: null,
      extensionIdentity: null,
    };
  }

  getState() {
    return { ...this.state };
  }

  getJoinWindow() {
    return this.activeJoinWindow;
  }

  getTarget() {
    return this.target;
  }

  getSessionId() {
    return this.state.sessionId;
  }

  getExtensionIdentity() {
    return this.state.extensionIdentity;
  }

  beginOpenJoinWindow(target?: SessionTarget | null) {
    this.target = target ?? this.target;
    this.emit({
      status: this.statusWhileConnecting("creating"),
      error: null,
      target: this.target,
    });
  }

  joinWindowOpened(joinWindow: JoinWindow, extensionIdentity?: ExtensionIdentity | null) {
    this.activeJoinWindow = joinWindow;
    this.state.sessionId = joinWindow.sessionId;
    this.emit({
      status: this.statusWhileConnecting("waiting"),
      qrCodeUrl: joinWindow.qrCodeUrl,
      error: null,
      joinWindowExpiresAt: joinWindow.expiresAt ?? null,
      extensionIdentity: extensionIdentity ?? this.state.extensionIdentity,
    });
  }

  joinWindowOpenFailed(error: string) {
    this.activeJoinWindow = null;
    this.emit({
      status: this.statusWhileConnecting("error"),
      error,
      qrCodeUrl: null,
      joinWindowExpiresAt: null,
    });
  }

  takeJoinWindowForClose() {
    const previous = this.activeJoinWindow;
    this.activeJoinWindow = null;
    return previous;
  }

  joinWindowClosed() {
    this.emit({
      status: this.statusAfterJoinWindowClose(),
      qrCodeUrl: null,
      joinWindowExpiresAt: null,
      error: null,
    });
  }

  disconnected() {
    this.activeJoinWindow = null;
    this.emit({
      status: "disconnected",
      qrCodeUrl: null,
      error: null,
      connectedAt: null,
      connectedPeerCount: 0,
      joinWindowExpiresAt: null,
    });
  }

  updateTarget(target?: SessionTarget | null) {
    this.target = target ?? null;
    this.emit({ target: this.target });
  }

  updateExtensionIdentity(identity: ExtensionIdentity) {
    this.state.sessionId = identity.installId;
    this.emit({ extensionIdentity: identity });
  }

  setSessionId(sessionId: string) {
    this.state.sessionId = sessionId;
  }

  peerConnected() {
    this.emit({
      status: "connected",
      error: null,
      connectedAt: this.state.connectedAt ?? new Date().toISOString(),
    });
  }

  peerClosed() {
    const connectedPeerCount = this.options.countConnectedPeers();
    this.emit({
      status: connectedPeerCount > 0 ? "connected" : this.activeJoinWindow ? "waiting" : "disconnected",
      connectedAt: connectedPeerCount > 0 ? this.state.connectedAt : null,
    });
  }

  private statusWhileConnecting(emptyPeerStatus: ScannerConnectionStatus) {
    return this.options.countConnectedPeers() > 0 ? "connected" : emptyPeerStatus;
  }

  private statusAfterJoinWindowClose() {
    return this.options.countConnectedPeers() > 0 ? "connected" : "disconnected";
  }

  private emit(patch: Partial<MobileScannerSessionState>) {
    this.state = {
      ...this.state,
      ...patch,
      connectedPeerCount: this.options.countConnectedPeers(),
    };
    this.options.onState(this.getState());
  }
}
