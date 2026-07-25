import type {
  CaptureMode,
  ScannerConnectionStatus,
} from "@volt/scanner-protocol";
import { buildScannerAppClipJoinUrl } from "@volt/scanner-protocol";
import { createClerkClient } from "@clerk/chrome-extension/client";
import { ConvexClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import {
  CLERK_PUBLISHABLE_KEY,
  CLERK_SYNC_HOST,
  convexDeploymentUrlFromHttpActionsUrl,
} from "../access/config";
import {
  CLERK_CONVEX_TOKEN_STORAGE_KEY,
  readPublishedClerkConvexToken,
} from "../access/clerk-convex-token";
import { recordWorkspaceDiagnostic } from "../cloud-scanner/workspace-diagnostics";
import {
  MobileScannerSession,
  type BarcodeMessage,
  type ExtensionIdentity,
  type MobileScannerSessionState,
  type PhotoMessage,
  type SessionTarget,
} from "../domain/mobile-scanner-session";
import { getMobileScannerExtensionIdentity } from "../domain/mobile-scanner-identity";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../domain/mobile-scanner-signal-url";

const COMPUTER_REGISTRATION_KEY = "volt.cloudScanner.computerRegistration.v1";
const COMPUTER_REGISTRATION_TTL_MS = 120_000;
const COMPUTER_REGISTRATION_INTERVAL_MS = 60_000;
const COMPUTER_CAPABILITIES = [
  "workspace-results",
  "cursor-insertion",
  "photo-download",
];

function serializeLogArg(arg: unknown) {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack };
  }
  return arg;
}

type ScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  mode: CaptureMode | null;
  connectedAt: string | null;
  connectedPeerCount?: number;
  joinWindowExpiresAt?: string | null;
  sessionId?: string;
  usageSessionId?: string;
  target?: SessionTarget | null;
  extensionIdentity?: ExtensionIdentity | null;
};

function objectFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function accessErrorMessage(response: unknown) {
  const record = objectFrom(response);
  const status = objectFrom(record?.accessStatus);
  if (status?.requiresSignIn === true) {
    return "Your five free sessions are used. Sign in to continue.";
  }
  if (status?.requiresSubscription === true) {
    return "A Volt Pro subscription is required. Subscribe in the full iPhone app.";
  }
  return typeof record?.error === "string"
    ? record.error
    : "Scanner access could not be verified.";
}

function normalizeCaptureMode(value: unknown): CaptureMode | null {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo"
    ? value
    : null;
}

function normalizeTarget(value: unknown): SessionTarget | null {
  return value && typeof value === "object" ? (value as SessionTarget) : null;
}

function isJoinWindowActive(state: MobileScannerSessionState) {
  if (!state.qrCodeUrl) return false;
  if (!state.joinWindowExpiresAt) return true;
  const expiresAt = Date.parse(state.joinWindowExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

// "unknown" means we could not reach Clerk, not that the user signed out.
// The two must stay distinct: a sign-out wipes the local result history, so
// treating a failed handshake as one destroys already-synced captures.
type ClerkAuthState =
  | { status: "signed-in"; token: string }
  | { status: "signed-out" }
  | { status: "unknown" };

const SIGNED_OUT_RECHECK_MS = 60_000;

// createClerkClient({ background: true }) performs a full Frontend API
// handshake on every call, so the reconcile loop must reuse one client instead
// of minting one every 15s and getting rate limited into a permanent outage.
let backgroundClerkPromise: Promise<Awaited<
  ReturnType<typeof createClerkClient>
>> | null = null;
let lastSignedOutAt = 0;

function backgroundClerkClient() {
  if (!backgroundClerkPromise) {
    backgroundClerkPromise = createClerkClient({
      publishableKey: CLERK_PUBLISHABLE_KEY,
      syncHost: CLERK_SYNC_HOST,
      background: true,
    }).catch((error: unknown) => {
      backgroundClerkPromise = null;
      throw error;
    });
  }
  return backgroundClerkPromise;
}

async function readPublishedTokenSafely() {
  try {
    return await readPublishedClerkConvexToken();
  } catch (error) {
    // chrome.storage.session is not guaranteed to this context. A throw here
    // used to reject the whole reconcile pass and strand the workspace.
    void recordWorkspaceDiagnostic({
      stage: "clerk-token",
      status: "error",
      detail: `session_storage_unavailable: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

async function resolveClerkAuth(): Promise<ClerkAuthState> {
  const published = await readPublishedTokenSafely();
  if (published) {
    lastSignedOutAt = 0;
    void recordWorkspaceDiagnostic({ stage: "clerk-token", status: "ok", detail: "sidepanel" });
    return { status: "signed-in", token: published };
  }
  if (!CLERK_PUBLISHABLE_KEY) {
    void recordWorkspaceDiagnostic({
      stage: "clerk-token",
      status: "error",
      detail: "missing_publishable_key",
    });
    return { status: "unknown" };
  }
  // Offscreen documents get a reduced extension API surface, and Clerk's
  // syncHost handshake reads the __client cookie through chrome.cookies. When
  // that API is absent no token can be minted here at all, so report it rather
  // than retrying a handshake that can never succeed.
  if (!chrome.cookies) {
    void recordWorkspaceDiagnostic({
      stage: "clerk-token",
      status: "error",
      detail: "offscreen_cookies_unavailable",
    });
    return { status: "unknown" };
  }
  if (!backgroundClerkPromise && Date.now() - lastSignedOutAt < SIGNED_OUT_RECHECK_MS) {
    return { status: "signed-out" };
  }
  try {
    const clerk = await backgroundClerkClient();
    if (!clerk.session) {
      // Drop the cached client so a later sign-in is picked up, but rate limit
      // how often the signed-out state is re-verified against Clerk.
      backgroundClerkPromise = null;
      lastSignedOutAt = Date.now();
      void recordWorkspaceDiagnostic({ stage: "clerk-token", status: "signed-out" });
      return { status: "signed-out" };
    }
    const token = await clerk.session.getToken({
      template: "convex",
      organizationId: clerk.organization?.id,
      skipCache: true,
    });
    if (!token) {
      backgroundClerkPromise = null;
      void recordWorkspaceDiagnostic({
        stage: "clerk-token",
        status: "error",
        detail: "convex_template_returned_no_token",
      });
      return { status: "unknown" };
    }
    lastSignedOutAt = 0;
    void recordWorkspaceDiagnostic({ stage: "clerk-token", status: "ok", detail: "background" });
    return { status: "signed-in", token };
  } catch (error) {
    console.warn("[Volt Cloud Workspace] Clerk token fetch failed", error);
    backgroundClerkPromise = null;
    void recordWorkspaceDiagnostic({
      stage: "clerk-token",
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    });
    return { status: "unknown" };
  }
}

async function getClerkToken() {
  const auth = await resolveClerkAuth();
  return auth.status === "signed-in" ? auth.token : null;
}

function clerkSubjectFromToken(token: string | null) {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    const record = objectFrom(decoded);
    return typeof record?.sub === "string" && record.sub ? record.sub : null;
  } catch {
    return null;
  }
}

class CloudWorkspaceSubscriptions {
  private readonly client = new ConvexClient(
    convexDeploymentUrlFromHttpActionsUrl(EXTENSION_SCANNER_SIGNAL_URL),
  );
  private workspaceSnapshotUnsubscribe: (() => void) | null = null;
  private cursorDeliveriesUnsubscribe: (() => void) | null = null;
  private computerRegistrationInterval: number | null = null;
  private installationId: string | null = null;
  private clerkSubject: string | null = null;
  private hasReconciledSubject = false;
  private lastSnapshot: unknown = null;
  private started = false;
  private reconciling: Promise<void> | null = null;
  private reconcileAgain = false;

  constructor() {
    this.armClientAuth();
  }

  // ConvexClient auth is not self-healing: if the fetcher returns null at
  // setAuth time (plus one forced refetch), the client settles into noAuth
  // and never calls the fetcher again. Re-arming is the only way back.
  private armClientAuth() {
    this.client.setAuth(getClerkToken, () => {
      void this.reconcileAuthentication();
    });
  }

  private clientAuthSubject() {
    const claims = this.client.getAuth()?.decoded;
    return typeof claims?.sub === "string" && claims.sub ? claims.sub : null;
  }

  start() {
    if (this.started) return;
    this.started = true;
    void this.reconcileAuthentication();
    window.setInterval(() => {
      void this.reconcileAuthentication();
    }, 15_000);
    chrome.storage.session.onChanged.addListener((changes) => {
      if (CLERK_CONVEX_TOKEN_STORAGE_KEY in changes) {
        void this.reconcileAuthentication();
      }
    });
  }

  private stopSubscriptions() {
    this.workspaceSnapshotUnsubscribe?.();
    this.cursorDeliveriesUnsubscribe?.();
    this.workspaceSnapshotUnsubscribe = null;
    this.cursorDeliveriesUnsubscribe = null;
    if (this.computerRegistrationInterval !== null) {
      window.clearInterval(this.computerRegistrationInterval);
      this.computerRegistrationInterval = null;
    }
    this.installationId = null;
  }

  private async registerComputer() {
    if (!this.installationId) throw new Error("Cloud workspace is not signed in.");
    const identity = await getMobileScannerExtensionIdentity();
    const registration = await this.client.mutation(api.cloudWorkspace.registerComputer, {
      installationId: this.installationId,
      label: identity.sessionLabel,
      capabilities: COMPUTER_CAPABILITIES,
      ttlMs: COMPUTER_REGISTRATION_TTL_MS,
    });
    await chrome.storage.local.set({ [COMPUTER_REGISTRATION_KEY]: registration });
    return registration;
  }

  private startComputerRegistration() {
    const register = () => {
      if (!this.installationId) return;
      void this.registerComputer()
        .then(() => recordWorkspaceDiagnostic({ stage: "registration", status: "ok" }))
        .catch((error: unknown) => {
          console.warn("[Volt Cloud Workspace] computer registration failed", error);
          void recordWorkspaceDiagnostic({
            stage: "registration",
            status: "error",
            detail: error instanceof Error ? error.message : String(error),
          });
          // The first attempt races the Convex client's auth handshake. Without
          // a short retry the phone shows this computer offline for a full
          // registration interval even though everything else recovered.
          window.setTimeout(register, 5_000);
        });
    };
    this.computerRegistrationInterval = window.setInterval(
      register,
      COMPUTER_REGISTRATION_INTERVAL_MS,
    );
    register();
  }

  private async reconcileAuthenticationNow() {
    const auth = await resolveClerkAuth();
    // A transient Clerk failure must not tear down subscriptions or report a
    // sign-out to the background — the next pass retries with state intact.
    if (auth.status === "unknown") return;
    const token = auth.status === "signed-in" ? auth.token : null;
    const subject = clerkSubjectFromToken(token);
    const subscriptionsActive =
      this.workspaceSnapshotUnsubscribe !== null
      && this.cursorDeliveriesUnsubscribe !== null;
    const clientAuthenticated = subject !== null && this.clientAuthSubject() === subject;
    if (
      this.hasReconciledSubject
      && subject === this.clerkSubject
      && (subject === null || (subscriptionsActive && clientAuthenticated))
    ) return;

    this.stopSubscriptions();
    if (subject !== null && !clientAuthenticated) this.armClientAuth();
    const accountResponse = await chrome.runtime.sendMessage({
      action: "workspaceOffscreenAccountChanged",
      subject,
    });
    const accountRecord = objectFrom(accountResponse);
    if (accountRecord?.success !== true) {
      void recordWorkspaceDiagnostic({
        stage: "account-sync",
        status: "error",
        detail: typeof accountRecord?.error === "string" ? accountRecord.error : "no_response",
      });
      return;
    }

    this.clerkSubject = subject;
    this.hasReconciledSubject = true;
    this.lastSnapshot = null;
    if (!subject) return;

    const identity = await getMobileScannerExtensionIdentity();
    this.installationId = identity.installId;
    this.workspaceSnapshotUnsubscribe = this.client.onUpdate(
      api.cloudWorkspace.workspaceSnapshot,
      {},
      (snapshot) => {
        this.lastSnapshot = snapshot;
        void recordWorkspaceDiagnostic({ stage: "subscriptions", status: "ok" });
        void chrome.runtime.sendMessage({
          action: "workspaceOffscreenSnapshotChanged",
          snapshot,
        }).catch(() => undefined);
      },
      (error) => {
        console.warn("[Volt Cloud Workspace] snapshot subscription failed", error);
        void recordWorkspaceDiagnostic({
          stage: "subscriptions",
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
        });
      },
    );
    this.cursorDeliveriesUnsubscribe = this.client.onUpdate(
      api.cloudWorkspace.pendingCursorDeliveries,
      { installationId: identity.installId },
      (deliveries) => {
        void chrome.runtime.sendMessage({
          action: "workspaceOffscreenCursorDeliveriesChanged",
          deliveries,
        }).catch(() => undefined);
      },
      (error) => console.warn("[Volt Cloud Workspace] cursor subscription failed", error),
    );
    this.startComputerRegistration();
  }

  reconcileAuthentication() {
    // A request landing while a pass is in flight must trigger one more full
    // pass, not coalesce into the current one — the in-flight pass may have
    // already read stale auth state (e.g. setAuth's onChange fires mid-pass).
    if (this.reconciling) {
      this.reconcileAgain = true;
      return this.reconciling;
    }
    this.reconciling = this.reconcileAuthenticationNow()
      // An unexpected throw anywhere in the pass used to reject into nothing and
      // leave the workspace unsubscribed until the next service worker restart.
      .catch((error: unknown) => {
        console.warn("[Volt Cloud Workspace] auth reconcile failed", error);
        void recordWorkspaceDiagnostic({
          stage: "account-sync",
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.reconciling = null;
        if (this.reconcileAgain) {
          this.reconcileAgain = false;
          void this.reconcileAuthentication();
        }
      });
    return this.reconciling;
  }

  async reconcileSnapshot() {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) return null;
    try {
      const snapshot = await this.client.query(api.cloudWorkspace.workspaceSnapshot, {});
      this.lastSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      if (this.lastSnapshot !== null) return this.lastSnapshot;
      throw error;
    }
  }

  async createEnrollment(label: string) {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) throw new Error("Cloud workspace is not signed in.");
    return this.client.mutation(api.cloudWorkspace.createEnrollment, {
      kind: "ios",
      label,
    });
  }

  async createPhotoDownloadUrl(batchId: string, resultId: string) {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) throw new Error("Cloud workspace is not signed in.");
    return this.client.action(api.cloudWorkspace.createPhotoDownloadUrl, {
      batchId,
      resultId,
    });
  }

  async deleteWorkspaceResults(resultIds: string[]) {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) throw new Error("Cloud workspace is not signed in.");
    return this.client.mutation(api.cloudWorkspace.deleteWorkspaceResults, { resultIds });
  }

  async restoreWorkspaceResults(resultIds: string[]) {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) throw new Error("Cloud workspace is not signed in.");
    return this.client.mutation(api.cloudWorkspace.restoreWorkspaceResults, { resultIds });
  }

  async acknowledgeCursorDelivery(
    deliveryId: string,
    state: "delivered" | "failed",
    errorCode?: string,
  ) {
    await this.reconcileAuthentication();
    if (!this.installationId) throw new Error("Cloud workspace is not signed in.");
    return this.client.mutation(api.cloudWorkspace.acknowledgeCursorDelivery, {
      installationId: this.installationId,
      deliveryId,
      state,
      ...(errorCode ? { errorCode } : {}),
    });
  }
}

class MobileScannerOffscreenSession {
  private webRtcSession: MobileScannerSession;
  private state: ScannerState = {
    status: "disconnected",
    qrCodeUrl: null,
    error: null,
    mode: null,
    connectedAt: null,
  };

  constructor() {
    this.webRtcSession = new MobileScannerSession({
      onState: (state) => this.handleWebRtcState(state),
      onScan: (scan) => this.sendScan(scan),
      onPhoto: (photo) => this.sendPhoto(photo),
      createJoinWindow: async (input) => {
        const response = await chrome.runtime.sendMessage({
          action: "accessCreateJoinWindow",
          ...input,
        });
        const responseRecord = objectFrom(response);
        const value = objectFrom(responseRecord?.value);
        if (responseRecord?.success !== true || !value) {
          throw new Error(accessErrorMessage(response));
        }
        const joinToken =
          typeof value.token === "string"
            ? value.token
            : typeof value.joinToken === "string"
              ? value.joinToken
              : "";
        const sessionId =
          typeof value.sessionId === "string" ? value.sessionId : input.sessionId;
        const usageSessionId =
          typeof value.usageSessionId === "string" ? value.usageSessionId : "";
        if (!joinToken || !usageSessionId) {
          throw new Error("Scanner access response omitted session credentials.");
        }
        const qrCodeUrl =
          typeof value.qrCodeUrl === "string"
            ? value.qrCodeUrl
            : buildScannerAppClipJoinUrl({
                token: joinToken,
                sessionId,
                label: input.deviceLabel,
                signalUrl: EXTENSION_SCANNER_SIGNAL_URL,
              });
        return {
          joinToken,
          qrCodeUrl,
          sessionId,
          usageSessionId,
          expiresAt:
            typeof value.expiresAt === "string" ? value.expiresAt : undefined,
        };
      },
      onSessionReady: async ({ joinToken, usageSessionId }) => {
        const response = await chrome.runtime.sendMessage({
          action: "accessSessionReady",
          joinToken,
          usageSessionId,
        });
        const record = objectFrom(response);
        return record?.success === true
          ? { allowed: true }
          : { allowed: false, error: accessErrorMessage(response) };
      },
      onSessionDisconnected: async (usageSessionId) => {
        await chrome.runtime
          .sendMessage({
            action: "accessSessionDisconnected",
            usageSessionId,
          })
          .catch(() => undefined);
      },
      onSessionEnded: async (usageSessionId) => {
        await chrome.runtime
          .sendMessage({ action: "accessSessionEnded", usageSessionId })
          .catch(() => undefined);
      },
      log: (...args) => {
        console.debug(...args);
        void chrome.runtime.sendMessage({
          action: "scannerDebugLog",
          source: "scanner-offscreen",
          args: args.map(serializeLogArg),
        }).catch(() => {});
      },
    });
  }

  async getState() {
    return { ...this.state };
  }

  private handleWebRtcState(state: MobileScannerSessionState) {
    this.setState({
      status: state.status,
      qrCodeUrl: state.qrCodeUrl,
      error: state.error,
      connectedAt: state.connectedAt,
      connectedPeerCount: state.connectedPeerCount,
      joinWindowExpiresAt: state.joinWindowExpiresAt,
      sessionId: state.sessionId,
      usageSessionId: state.usageSessionId,
      target: state.target,
      extensionIdentity: state.extensionIdentity,
    });
  }

  private setState(patch: Partial<ScannerState>) {
    this.state = { ...this.state, ...patch };
    void chrome.runtime.sendMessage({
      action: "scannerStateChanged",
      source: "scanner-offscreen",
      state: { ...this.state },
    });
  }

  async start(force = false, mode: CaptureMode | null = null, target?: SessionTarget | null) {
    if (!force) {
      const webRtcState = this.webRtcSession.getState();
      if (isJoinWindowActive(webRtcState)) {
        this.handleWebRtcState(webRtcState);
        this.setState({ mode });
        return { ...this.state };
      }
    }
    const state = await this.webRtcSession.openJoinWindow(target);
    this.handleWebRtcState(state);
    this.setState({ mode });
    return { ...this.state };
  }

  async closeJoinWindow() {
    const state = await this.webRtcSession.closeJoinWindow();
    this.handleWebRtcState(state);
    return { ...this.state };
  }

  async disconnect() {
    const state = await this.webRtcSession.disconnect();
    this.handleWebRtcState(state);
    this.setState({ mode: null });
    return { ...this.state };
  }

  async updateTarget(target?: SessionTarget | null) {
    await this.webRtcSession.updateTarget(target);
    return this.getState();
  }

  async updateExtensionIdentity(identity?: ExtensionIdentity | null) {
    const state = await this.webRtcSession.updateExtensionIdentity(identity);
    this.handleWebRtcState(state);
    return this.getState();
  }

  async pollReconnectRequestsNow() {
    const state = await this.webRtcSession.pollReconnectRequestsNow();
    this.handleWebRtcState(state);
    return this.getState();
  }

  private async sendScan(data: BarcodeMessage) {
    const response = await chrome.runtime.sendMessage({
      action: "scannerOffscreenScan",
      scan: {
        ...data,
        id: data.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        scannedAt: data.scannedAt || new Date().toISOString(),
      },
    });
    return {
      saved: response?.success !== false,
      insertedIntoCursor: response?.insertedIntoCursor === true,
    };
  }

  private async sendPhoto(photo: PhotoMessage) {
    return chrome.runtime.sendMessage({
      action: "scannerOffscreenPhoto",
      photo: {
        ...photo,
        capturedAt: photo.capturedAt || new Date().toISOString(),
        sessionId: this.state.sessionId,
      },
    });
  }
}

const mobileScannerSession = new MobileScannerOffscreenSession();
const cloudWorkspaceSubscriptions = new CloudWorkspaceSubscriptions();
cloudWorkspaceSubscriptions.start();

function sendScannerError(sendResponse: (response?: unknown) => void, err: unknown) {
  sendResponse({
    status: "error",
    qrCodeUrl: null,
    error: err instanceof Error ? err.message : String(err),
    mode: null,
  });
}

function sendWorkspaceOperation(
  sendResponse: (response?: unknown) => void,
  operation: Promise<unknown>,
) {
  void operation
    .then((value) => sendResponse({ success: true, value }))
    .catch((error: unknown) => sendResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.action === "workspaceOffscreenStartSubscriptions"
    || message.action === "workspaceOffscreenReconcile"
    || message.action === "workspaceOffscreenCreateEnrollment"
    || message.action === "workspaceOffscreenCreatePhotoDownloadUrl"
    || message.action === "workspaceOffscreenDeleteResults"
    || message.action === "workspaceOffscreenRestoreResults"
    || message.action === "workspaceOffscreenAcknowledgeCursorDelivery"
  ) {
    if (sender.id !== chrome.runtime.id || sender.tab) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return false;
    }
    if (message.action === "workspaceOffscreenStartSubscriptions") {
      cloudWorkspaceSubscriptions.start();
      return sendWorkspaceOperation(
        sendResponse,
        cloudWorkspaceSubscriptions.reconcileAuthentication(),
      );
    }
    if (message.action === "workspaceOffscreenReconcile") {
      void cloudWorkspaceSubscriptions.reconcileSnapshot()
        .then((snapshot) => sendResponse({ success: true, snapshot }))
        .catch((error: unknown) => sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      return true;
    }
    if (message.action === "workspaceOffscreenCreateEnrollment") {
      const label = typeof message.label === "string" ? message.label.trim().slice(0, 80) : "";
      if (!label) {
        sendResponse({ success: false, error: "invalid_enrollment_label" });
        return false;
      }
      return sendWorkspaceOperation(
        sendResponse,
        cloudWorkspaceSubscriptions.createEnrollment(label),
      );
    }
    if (message.action === "workspaceOffscreenCreatePhotoDownloadUrl") {
      const batchId = typeof message.batchId === "string" ? message.batchId : "";
      const resultId = typeof message.resultId === "string" ? message.resultId : "";
      if (!batchId || !resultId) {
        sendResponse({ success: false, error: "invalid_photo_download_request" });
        return false;
      }
      return sendWorkspaceOperation(
        sendResponse,
        cloudWorkspaceSubscriptions.createPhotoDownloadUrl(batchId, resultId),
      );
    }
    if (
      message.action === "workspaceOffscreenDeleteResults"
      || message.action === "workspaceOffscreenRestoreResults"
    ) {
      const resultIds = Array.isArray(message.resultIds)
        ? message.resultIds
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
          .slice(0, 100)
        : [];
      if (resultIds.length === 0) {
        sendResponse({ success: false, error: "invalid_workspace_result_ids" });
        return false;
      }
      return sendWorkspaceOperation(
        sendResponse,
        message.action === "workspaceOffscreenDeleteResults"
          ? cloudWorkspaceSubscriptions.deleteWorkspaceResults(resultIds)
          : cloudWorkspaceSubscriptions.restoreWorkspaceResults(resultIds),
      );
    }
    const deliveryId = typeof message.deliveryId === "string" ? message.deliveryId : "";
    const state = message.state === "delivered" || message.state === "failed"
      ? message.state
      : null;
    if (!deliveryId || !state) {
      sendResponse({ success: false, error: "invalid_cursor_delivery_ack" });
      return false;
    }
    return sendWorkspaceOperation(
      sendResponse,
      cloudWorkspaceSubscriptions.acknowledgeCursorDelivery(
        deliveryId,
        state,
        typeof message.errorCode === "string" ? message.errorCode : undefined,
      ),
    );
  }

  if (message.action === "accessOffscreenGetClerkToken") {
    if (sender.id !== chrome.runtime.id || sender.tab) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return false;
    }
    getClerkToken()
      .then((token) => sendResponse({ success: true, token }))
      .catch((error: unknown) =>
        sendResponse({
          success: false,
          token: null,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.action === "scannerOffscreenPing") {
    sendResponse({ ready: true });
    return false;
  }

  if (message.action === "scannerOffscreenStart") {
    mobileScannerSession
      .start(message.force === true, normalizeCaptureMode(message.mode), normalizeTarget(message.target))
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenCloseJoinWindow") {
    mobileScannerSession
      .closeJoinWindow()
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenDisconnect") {
    mobileScannerSession
      .disconnect()
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenUpdateTarget") {
    mobileScannerSession
      .updateTarget(normalizeTarget(message.target))
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenUpdateExtensionIdentity") {
    mobileScannerSession
      .updateExtensionIdentity(
        message.identity && typeof message.identity === "object"
          ? (message.identity as ExtensionIdentity)
          : null,
      )
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenPollReconnectRequests") {
    console.debug("[Volt Scanner Reconnect] offscreen poll requested", {
      reason: message.reason,
    });
    mobileScannerSession
      .pollReconnectRequestsNow()
      .then((state) => {
        console.debug("[Volt Scanner Reconnect] offscreen poll completed", {
          reason: message.reason,
          status: state.status,
          sessionId: state.sessionId,
          connectedPeerCount: state.connectedPeerCount,
        });
        sendResponse(state);
      })
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
  }

  if (message.action === "scannerOffscreenGetState") {
    mobileScannerSession
      .getState()
      .then((state) => sendResponse(state))
      .catch((err) => sendScannerError(sendResponse, err));
    return true;
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
