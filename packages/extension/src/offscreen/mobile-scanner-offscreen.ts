import type {
  CaptureMode,
  ScannerConnectionStatus,
} from "@volt/scanner-protocol";
import { buildScannerAppClipJoinUrl } from "@volt/scanner-protocol";
import type { createClerkClient } from "@clerk/chrome-extension/client";
import { ConvexClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import {
  CLERK_PUBLISHABLE_KEY,
  convexDeploymentUrlFromHttpActionsUrl,
} from "../access/config";
import { offscreenStorageCache } from "./offscreen-storage-cache";
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
import {
  COMPUTER_REGISTRATION_INTERVAL_MS,
  registerComputer,
} from "../cloud-scanner/computer-registration";

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

// Offscreen documents get only the messaging half of chrome.runtime, so
// getManifest is absent here — and Clerk calls it to check that "storage" is
// permitted before it will mint a token, so every token fetch died on a
// TypeError. The document can still read the manifest over its own origin,
// which is the same file Clerk would have been handed anyway.
let manifestAccessPromise: Promise<void> | null = null;

// The chrome types agree it is absent, so the patch goes through a structural
// view of runtime rather than pretending the declared surface has it.
type ManifestReader = { getManifest?: () => unknown };

function ensureManifestAccess(): Promise<void> {
  const runtime: ManifestReader = chrome.runtime;
  if (typeof runtime.getManifest === "function") return Promise.resolve();
  if (!manifestAccessPromise) {
    manifestAccessPromise = fetch("/manifest.json")
      .then((response) => response.json())
      .then((manifest: unknown) => {
        runtime.getManifest = () => manifest;
      })
      .catch((error: unknown) => {
        manifestAccessPromise = null;
        throw error;
      });
  }
  return manifestAccessPromise;
}

function backgroundClerkClient() {
  if (!backgroundClerkPromise) {
    // Imported lazily: clerk-js is by far the heaviest thing this document
    // touches, and pulling it into the startup path delayed the message
    // listener past the service worker's readiness ping, which then tore the
    // document down as broken. Nothing here is needed until a token is minted.
    //
    // The cookie handshake is deliberately left unconfigured: offscreen
    // documents have no chrome.cookies to run it with. Clerk instead reads the
    // client JWT the service worker mirrors into chrome.storage.local, which is
    // what puts this document on the same account as every other Volt surface.
    // It reads it through storageCache, because chrome.storage is missing here
    // too and Clerk's default cache goes straight to browser.storage.local.
    backgroundClerkPromise = ensureManifestAccess()
      .then(() => import("@clerk/chrome-extension/client"))
      .then((clerk) =>
        clerk.createClerkClient({
          publishableKey: CLERK_PUBLISHABLE_KEY,
          background: true,
          storageCache: offscreenStorageCache,
        }),
      )
      .catch((error: unknown) => {
        backgroundClerkPromise = null;
        throw error;
      });
  }
  return backgroundClerkPromise;
}

async function resolveClerkAuth(): Promise<ClerkAuthState> {
  if (!CLERK_PUBLISHABLE_KEY) return { status: "unknown" };
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
      return { status: "signed-out" };
    }
    const token = await clerk.session.getToken({
      template: "convex",
      organizationId: clerk.organization?.id,
      skipCache: true,
    });
    if (!token) {
      backgroundClerkPromise = null;
      return { status: "unknown" };
    }
    lastSignedOutAt = 0;
    return { status: "signed-in", token };
  } catch (error) {
    console.warn("[Volt Cloud Workspace] Clerk token fetch failed", error);
    backgroundClerkPromise = null;
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
  private dictationDraftsUnsubscribe: (() => void) | null = null;
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
  }

  // The service worker owns the mirrored client JWT and tells this document
  // when it changes; watching chrome.storage from here is not an option since
  // the API is absent. The cached Clerk client holds the old session, so it has
  // to be dropped before the account change can take effect.
  accountChanged() {
    backgroundClerkPromise = null;
    lastSignedOutAt = 0;
    return this.reconcileAuthentication();
  }

  private stopSubscriptions() {
    this.workspaceSnapshotUnsubscribe?.();
    this.cursorDeliveriesUnsubscribe?.();
    this.dictationDraftsUnsubscribe?.();
    this.workspaceSnapshotUnsubscribe = null;
    this.cursorDeliveriesUnsubscribe = null;
    this.dictationDraftsUnsubscribe = null;
    if (this.computerRegistrationInterval !== null) {
      window.clearInterval(this.computerRegistrationInterval);
      this.computerRegistrationInterval = null;
    }
    this.installationId = null;
  }

  private async registerComputer() {
    if (!this.installationId) throw new Error("Cloud workspace is not signed in.");
    return await registerComputer(this.client);
  }

  private startComputerRegistration() {
    const register = () => {
      if (!this.installationId) return;
      void this.registerComputer()
        .catch((error: unknown) => {
          console.warn("[Volt Cloud Workspace] computer registration failed", error);
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
      && this.cursorDeliveriesUnsubscribe !== null
      && this.dictationDraftsUnsubscribe !== null;
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
      console.warn(
        "[Volt Cloud Workspace] account sync rejected",
        typeof accountRecord?.error === "string" ? accountRecord.error : "no_response",
      );
      return;
    }

    this.clerkSubject = subject;
    this.hasReconciledSubject = true;
    this.lastSnapshot = null;
    if (!subject) {
      // Not an error on its own — but this document reads the account from the
      // cookie the service worker mirrors into storage, so it can sit here
      // signed out while the panel is signed in perfectly well. Nothing else
      // reports that split, and it is the difference between a computer the
      // phone can see and one it cannot.
      console.warn(
        "[Volt Cloud Workspace] offscreen has no Clerk session; this computer will not register from here",
      );
      return;
    }

    const identity = await getMobileScannerExtensionIdentity();
    this.installationId = identity.installId;
    this.workspaceSnapshotUnsubscribe = this.client.onUpdate(
      api.cloudWorkspace.workspaceSnapshot,
      {},
      (snapshot) => {
        this.lastSnapshot = snapshot;
        void chrome.runtime.sendMessage({
          action: "workspaceOffscreenSnapshotChanged",
          snapshot,
        }).catch(() => undefined);
      },
      (error) => {
        console.warn("[Volt Cloud Workspace] snapshot subscription failed", error);
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
    this.dictationDraftsUnsubscribe = this.client.onUpdate(
      api.cloudWorkspace.liveDictationDraftsForComputer,
      { installationId: identity.installId },
      (drafts) => {
        void chrome.runtime.sendMessage({
          action: "workspaceOffscreenDictationDraftsChanged",
          drafts,
        }).catch(() => undefined);
      },
      (error) => console.warn("[Volt Cloud Workspace] dictation subscription failed", error),
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

// Answering the readiness ping is what keeps the service worker from closing
// this document, so claim it before opening sockets or scheduling any work.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== "scannerOffscreenPing") return false;
  sendResponse({ ready: true });
  return false;
});

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
        message.accountChanged === true
          ? cloudWorkspaceSubscriptions.accountChanged()
          : cloudWorkspaceSubscriptions.reconcileAuthentication(),
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
