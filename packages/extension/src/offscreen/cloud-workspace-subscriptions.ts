import { subscribeWorkspaceSnapshot, fetchWorkspaceSnapshot } from "@volt/scanner-protocol";
import type { createClerkClient } from "@clerk/chrome-extension/client";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import { CLERK_PUBLISHABLE_KEY, convexDeploymentUrlFromHttpActionsUrl } from "../access/config";
import { offscreenStorageCache } from "./offscreen-storage-cache";
import { getMobileScannerExtensionIdentity } from "../domain/mobile-scanner-identity";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../domain/mobile-scanner-signal-url";
import { COMPUTER_REGISTRATION_INTERVAL_MS, registerComputer } from "../cloud-scanner/computer-registration";
import { createComputerRegistrationHeartbeat } from "../cloud-scanner/computer-registration-heartbeat";

type ExtensionSettingsRecord = {
  payload: string;
  revision: number;
  updatedAt: number;
};

const getExtensionSettingsReference = makeFunctionReference<
  "query",
  Record<string, never>,
  ExtensionSettingsRecord | null
>("extensionSettings:get");
const saveExtensionSettingsReference = makeFunctionReference<
  "mutation",
  { payload: string; expectedRevision: number | null; expectedSubject: string },
  ExtensionSettingsRecord
>("extensionSettings:save");
const shopifyStartConnectReference = makeFunctionReference<
  "action", { shop: string }, { url: string }
>("shopifyAudit:startConnect");
const shopifyGetConnectionReference = makeFunctionReference<
  "query", Record<string, never>, { shop: string } | null
>("shopifyAudit:getConnection");
const shopifyDisconnectReference = makeFunctionReference<
  "mutation", Record<string, never>, null
>("shopifyAudit:disconnect");
const shopifyListYesterdayReference = makeFunctionReference<
  "action", { startUtc: string; endUtc: string; date: string },
  { shop: string; date: string; products: Array<{ id: string; title: string; status: string; url: string }> }
>("shopifyAudit:listYesterday");
const shopifySearchProductsReference = makeFunctionReference<
  "action", { query: string },
  { shop: string; products: Array<{ id: string; title: string; status: string; totalInventory: number; url: string; imageUrl: string | null; price: string | null; currencyCode: string | null; condition: string | null; sku: string | null }> }
>("shopifyAudit:searchProducts");

export function objectFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

export async function getClerkToken() {
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

export class CloudWorkspaceSubscriptions {
  private readonly client = new ConvexClient(
    convexDeploymentUrlFromHttpActionsUrl(EXTENSION_SCANNER_SIGNAL_URL),
  );
  private workspaceSnapshotUnsubscribe: (() => void) | null = null;
  private cursorDeliveriesUnsubscribe: (() => void) | null = null;
  private dictationDraftsUnsubscribe: (() => void) | null = null;
  private computerRegistrationHeartbeat: ReturnType<
    typeof createComputerRegistrationHeartbeat
  > | null = null;
  private installationId: string | null = null;
  private clerkSubject: string | null = null;
  private hasReconciledSubject = false;
  private lastSnapshot: unknown = null;
  private started = false;
  private reconciling: Promise<void> | null = null;
  private reconcileAgain = false;
  private accountEpoch: string | null = null;
  private acceptedClientSubject: string | null = null;

  constructor() {
    this.armClientAuth();
  }

  // ConvexClient auth is not self-healing: if the fetcher returns null at
  // setAuth time (plus one forced refetch), the client settles into noAuth
  // and never calls the fetcher again. Re-arming is the only way back.
  private armClientAuth() {
    this.acceptedClientSubject = null;
    this.client.setAuth(getClerkToken, (authenticated) => {
      const claims = this.client.getAuth()?.decoded;
      this.acceptedClientSubject = authenticated && typeof claims?.sub === "string" ? claims.sub : null;
      void this.reconcileAuthentication();
    });
  }

  private clientAuthSubject() {
    return this.acceptedClientSubject;
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
  accountChanged(epoch: string, force = true) {
    if (this.accountEpoch === epoch && !force) return this.reconcileAuthentication();
    if (this.accountEpoch !== epoch) {
      this.accountEpoch = epoch;
      this.stopSubscriptions();
      this.hasReconciledSubject = false;
      this.lastSnapshot = null;
    }
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
    this.computerRegistrationHeartbeat?.stop();
    this.computerRegistrationHeartbeat = null;
    this.installationId = null;
  }

  private async registerComputer() {
    if (!this.installationId) throw new Error("Cloud workspace is not signed in.");
    return await registerComputer(this.client);
  }

  private startComputerRegistration() {
    this.computerRegistrationHeartbeat?.stop();
    this.computerRegistrationHeartbeat = createComputerRegistrationHeartbeat({
      attempt: () => this.registerComputer(),
      intervalMs: COMPUTER_REGISTRATION_INTERVAL_MS,
      retryDelayMs: 5_000,
      timers: {
        setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
        clearInterval: (id) => window.clearInterval(id),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (id) => window.clearTimeout(id),
      },
      onError: (error) => {
        console.warn("[Volt Cloud Workspace] computer registration failed", error);
      },
    });
    this.computerRegistrationHeartbeat.start();
  }

  private async reconcileAuthenticationNow() {
    const epoch = this.accountEpoch;
    if (epoch === null) return;
    const auth = await resolveClerkAuth();
    if (epoch !== this.accountEpoch) return;
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
    if (subject !== null && !clientAuthenticated) {
      this.armClientAuth();
      return;
    }
    const accountResponse = await chrome.runtime.sendMessage({
      action: "workspaceOffscreenAccountChanged",
      subject,
      accountEpoch: epoch,
    });
    const accountRecord = objectFrom(accountResponse);
    if (epoch !== this.accountEpoch) return;
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
    if (epoch !== this.accountEpoch) return;
    this.installationId = identity.installId;
    const snapshotSubject = this.clerkSubject;
    this.workspaceSnapshotUnsubscribe = subscribeWorkspaceSnapshot({
      subscribe: (args, onValue, onError) => this.client.onUpdate(api.cloudWorkspace.workspaceSnapshotPage, args, onValue, onError),
      onSnapshot: (snapshot) => {
        this.lastSnapshot = snapshot;
        void chrome.runtime.sendMessage({
          action: "workspaceOffscreenSnapshotChanged",
          subject: snapshotSubject,
          accountEpoch: epoch,
          snapshot,
        }).catch(() => undefined);
      },
      onError: (error) => {
        console.warn("[Volt Cloud Workspace] snapshot subscription failed", error);
      },
    });
    this.cursorDeliveriesUnsubscribe = this.client.onUpdate(
      api.cloudWorkspace.pendingCursorDeliveries,
      { installationId: identity.installId },
      (deliveries) => {
        void chrome.runtime.sendMessage({
          action: "workspaceOffscreenCursorDeliveriesChanged",
          subject: snapshotSubject,
          accountEpoch: epoch,
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
          subject: snapshotSubject,
          accountEpoch: epoch,
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
    const accountEpoch = this.accountEpoch;
    const subject = this.clerkSubject;
    const envelope = (snapshot: unknown) => ({ snapshot, subject, accountEpoch });
    if (!subject) return envelope(null);
    try {
      const snapshot = await fetchWorkspaceSnapshot((args) => this.client.query(api.cloudWorkspace.workspaceSnapshotPage, args));
      if (this.clerkSubject !== subject || this.accountEpoch !== accountEpoch) return envelope(null);
      this.lastSnapshot = snapshot;
      return envelope(snapshot);
    } catch (error) {
      if (this.clerkSubject !== subject || this.accountEpoch !== accountEpoch) return envelope(null);
      if (this.lastSnapshot !== null) return envelope(this.lastSnapshot);
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

  async getExtensionSettings() {
    await this.reconcileAuthentication();
    const subject = this.clerkSubject;
    if (!subject) return { value: null, subject: null };
    const value = await this.client.query(getExtensionSettingsReference, {});
    return value ? { ...value, subject } : { value: null, subject };
  }

  async saveExtensionSettings(payload: string, expectedRevision: number | null, expectedSubject: string) {
    await this.reconcileAuthentication();
    const subject = this.clerkSubject;
    if (!subject) throw new Error("Cloud settings require a signed-in account.");
    if (expectedSubject !== subject) {
      throw new Error("stale_extension_settings_subject");
    }
    const value = await this.client.mutation(saveExtensionSettingsReference, {
      payload,
      expectedRevision,
      expectedSubject: subject,
    });
    return { ...value, subject };
  }

  async getShopifyConnection() {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) throw new Error("Sign in to Volt before connecting Shopify.");
    return this.client.query(shopifyGetConnectionReference, {});
  }

  async startShopifyConnection(shop: string) {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) throw new Error("Sign in to Volt before connecting Shopify.");
    return this.client.action(shopifyStartConnectReference, { shop });
  }

  async disconnectShopify() {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) throw new Error("Sign in to Volt before disconnecting Shopify.");
    return this.client.mutation(shopifyDisconnectReference, {});
  }

  async listShopifyYesterday(startUtc: string, endUtc: string, date: string) {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) throw new Error("Sign in to Volt before auditing Shopify.");
    return this.client.action(shopifyListYesterdayReference, { startUtc, endUtc, date });
  }

  async searchShopifyProducts(query: string) {
    await this.reconcileAuthentication();
    if (!this.clerkSubject) throw new Error("Sign in to Volt before searching Shopify.");
    return this.client.action(shopifySearchProductsReference, { query });
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
