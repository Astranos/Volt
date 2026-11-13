import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { requestFields } from "./kioskRequestValidators";
import { handbookEntryFields } from "./handbookValidators";

const pushSubscription = v.object({
  endpoint: v.string(),
  expirationTime: v.optional(v.union(v.number(), v.null())),
  keys: v.object({
    auth: v.string(),
    p256dh: v.string(),
  }),
});

export default defineSchema({
  shopifyEmbeddedInstallations: defineTable({
    shop: v.string(),
    encryptedAccessToken: v.optional(v.string()),
    encryptedRefreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    refreshExpiresAt: v.optional(v.number()),
    exchangeLease: v.optional(v.object({ nonce: v.string(), expiresAt: v.number() })),
  }).index("by_shop", ["shop"]),
  // Shopify keeps one live offline token per app and store, so every Volt account connected
  // to a store shares this row; minting a new token invalidates the previous refresh token.
  shopifyStores: defineTable({
    shop: v.string(),
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.string(),
    expiresAt: v.number(),
    refreshExpiresAt: v.number(),
    refreshLease: v.optional(v.object({ nonce: v.string(), expiresAt: v.number() })),
  }).index("by_shop", ["shop"]),
  /** Which Volt accounts may use a store's shared token. */
  shopifyConnections: defineTable({
    ownerTokenIdentifier: v.string(),
    shop: v.string(),
    // Per-account tokens from before shopifyStores; shopifyStore:migrateSharedStores moves them.
    encryptedAccessToken: v.optional(v.string()),
    encryptedRefreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    refreshExpiresAt: v.optional(v.number()),
    refreshLease: v.optional(v.object({ nonce: v.string(), expiresAt: v.number() })),
  })
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"])
    .index("by_ownerTokenIdentifier_and_shop", ["ownerTokenIdentifier", "shop"])
    .index("by_shop", ["shop"]),
  shopifyHiddenProducts: defineTable({
    ownerTokenIdentifier: v.string(),
    shop: v.string(),
    productId: v.string(),
    title: v.string(),
  })
    .index("by_ownerTokenIdentifier_and_shop_and_productId", ["ownerTokenIdentifier", "shop", "productId"])
    .index("by_shop", ["shop"]),
  shopifyOAuthStates: defineTable({
    ownerTokenIdentifier: v.string(),
    shop: v.string(),
    state: v.string(),
    browserNonceHash: v.optional(v.string()),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_state", ["state"])
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"])
    .index("by_shop", ["shop"]),
  kioskRequests: defineTable({ ...requestFields, requestKey: v.string(), clientHash: v.string() })
    .index("by_storeSlug_and_requestKey", ["storeSlug", "requestKey"])
    .index("by_storeSlug_and_status_and_expiresAt", ["storeSlug", "status", "expiresAt"])
    .index("by_storeSlug_and_clientHash_and_createdAt", ["storeSlug", "clientHash", "createdAt"])
    .index("by_storeSlug_and_createdAt", ["storeSlug", "createdAt"]),
  workspaces: defineTable({
    ownerClerkUserId: v.string(),
    // Legacy storage counters, superseded by workspaceStorageUsage.
    managedRecordCount: v.optional(v.number()),
    managedByteCount: v.optional(v.number()),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerClerkUserId", ["ownerClerkUserId"]),
  workspaceStorageUsage: defineTable({
    workspaceId: v.id("workspaces"),
    recordCount: v.number(),
    byteCount: v.number(),
  }).index("by_workspaceId", ["workspaceId"]),

  workspaceEnrollments: defineTable({
    workspaceId: v.id("workspaces"),
    createdByClerkUserId: v.string(),
    codeHash: v.string(),
    deviceKind: v.union(v.literal("ios"), v.literal("chrome")),
    label: v.string(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_codeHash", ["codeHash"])
    .index("by_workspaceId", ["workspaceId"]),

  workspaceGuestGrants: defineTable({
    workspaceId: v.id("workspaces"),
    scannerJoinTokenId: v.optional(v.id("scannerJoinTokens")),
    usageSessionId: v.optional(v.string()),
    createdByClerkUserId: v.string(),
    grantHash: v.string(),
    sourceDeviceId: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_grantHash", ["grantHash"])
    .index("by_usageSessionId", ["usageSessionId"])
    .index("by_createdByClerkUserId", ["createdByClerkUserId"])
    .index("by_expiresAt", ["expiresAt"]),

  workspaceDevices: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    credentialHash: v.string(),
    kind: v.union(v.literal("ios"), v.literal("chrome")),
    label: v.string(),
    cursorTargetDeviceId: v.optional(v.string()),
    dictationBindingRequired: v.optional(v.boolean()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_deviceId", ["deviceId"])
    .index("by_workspaceId_and_kind_and_revokedAt", ["workspaceId", "kind", "revokedAt"])
    .index("by_workspaceId", ["workspaceId"]),

  workspacePresence: defineTable({
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    state: v.union(v.literal("online"), v.literal("offline")),
    capabilities: v.array(v.string()),
    lastSeenAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_deviceId", ["deviceId"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_state_and_expiresAt", ["state", "expiresAt"]),

  dictationDrafts: defineTable({
    workspaceId: v.id("workspaces"),
    draftId: v.string(),
    sourceDeviceId: v.string(),
    targetDeviceId: v.string(),
    targetRegistrationId: v.optional(v.id("workspaceDevices")),
    text: v.string(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_workspaceId_and_draftId", ["workspaceId", "draftId"])
    .index("by_workspaceId_targetDeviceId_targetRegistration_expires", ["workspaceId", "targetDeviceId", "targetRegistrationId", "expiresAt"])
    .index("by_targetDeviceId_and_expiresAt", ["targetDeviceId", "expiresAt"]),

  resultBatches: defineTable({
    workspaceId: v.id("workspaces"),
    batchId: v.string(),
    sourceDeviceId: v.string(),
    clientCreatedAt: v.number(),
    status: v.union(v.literal("uploading"), v.literal("ready"), v.literal("deleted")),
    resultCount: v.number(),
    byteCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_and_batchId", ["workspaceId", "batchId"]),

  scanResults: defineTable({
    workspaceId: v.id("workspaces"),
    batchId: v.string(),
    resultId: v.string(),
    sourceDeviceId: v.string(),
    kind: v.union(v.literal("text"), v.literal("barcode"), v.literal("photo"), v.literal("dictation")),
    text: v.optional(v.string()),
    format: v.optional(v.string()),
    objectKey: v.optional(v.string()),
    contentType: v.optional(v.string()),
    byteCount: v.number(),
    storageManaged: v.optional(v.boolean()),
    retentionTier: v.optional(v.union(v.literal("free"), v.literal("workspace"))),
    expiresAt: v.optional(v.number()),
    retentionCheckAt: v.optional(v.number()),
    purgeAfter: v.optional(v.number()),
    objectPurgedAt: v.optional(v.number()),
    checksum: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    clientCreatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_and_batchId", ["workspaceId", "batchId"])
    .index("by_workspaceId_and_resultId", ["workspaceId", "resultId"])
    .index("by_retentionCheckAt", ["retentionCheckAt"])
    .index("by_purgeAfter", ["purgeAfter"]),

  resultDeliveries: defineTable({
    workspaceId: v.id("workspaces"),
    batchId: v.string(),
    targetDeviceId: v.string(),
    state: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_and_batchId", ["workspaceId", "batchId"])
    .index("by_targetDeviceId", ["targetDeviceId"]),

  cursorDeliveries: defineTable({
    workspaceId: v.id("workspaces"),
    deliveryId: v.string(),
    resultId: v.string(),
    sourceDeviceId: v.string(),
    targetDeviceId: v.string(),
    kind: v.union(v.literal("barcode"), v.literal("text")),
    text: v.string(),
    format: v.optional(v.string()),
    state: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    attempts: v.number(),
    errorCode: v.optional(v.string()),
    clientCreatedAt: v.number(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_workspaceId_and_deliveryId", ["workspaceId", "deliveryId"])
    .index("by_targetDeviceId_and_state", ["targetDeviceId", "state"])
    .index("by_workspaceId_and_resultId", ["workspaceId", "resultId"])
    .index("by_state", ["state"]),

  users: defineTable({
    clerkUserId: v.string(),
    tokenIdentifier: v.string(),
    appAccountToken: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    freeSessionsConsumed: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_appAccountToken", ["appAccountToken"]),

  extensionSettings: defineTable({
    ownerClerkUserId: v.string(),
    ownerTokenIdentifier: v.string(),
    payload: v.string(),
    revision: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"]),

  handbookEntries: defineTable({
    workspaceId: v.id("workspaces"),
    ...handbookEntryFields,
    // Masked display text for secret entries; the values live in handbookSecrets.
    secretPreview: v.optional(v.string()),
    starterKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedByName: v.string(),
  })
    .index("by_workspaceId_and_order", ["workspaceId", "order"])
    .index("by_workspaceId_and_starterKey", ["workspaceId", "starterKey"]),
  // The account's chosen order of handbook categories. Categories not listed follow, in first-seen order.
  handbookCategoryOrders: defineTable({
    workspaceId: v.id("workspaces"),
    categories: v.array(v.string()),
  }).index("by_workspaceId", ["workspaceId"]),
  // Kept apart from handbookEntries so list and search reads never load a secret.
  handbookSecrets: defineTable({
    workspaceId: v.id("workspaces"),
    entryId: v.id("handbookEntries"),
    username: v.optional(v.string()),
    secret: v.string(),
  }).index("by_entryId", ["entryId"]),

  anonymousTrialGrants: defineTable({
    anonymousId: v.string(),
    credentialHash: v.string(),
    freeSessionLimit: v.number(),
    sessionsConsumed: v.number(),
    claimedByClerkUserId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_anonymousId", ["anonymousId"]),

  entitlements: defineTable({
    clerkUserId: v.string(),
    // Legacy manual rows remain valid in storage but no longer grant access.
    kind: v.union(v.literal("storekit"), v.literal("manual")),
    sourceIdentifier: v.string(),
    productId: v.string(),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("revoked")),
    validFrom: v.number(),
    expiresAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_clerkUserId_and_sourceIdentifier", ["clerkUserId", "sourceIdentifier"]),

  aiScannerRequests: defineTable({
    deviceId: v.string(),
    clerkUserId: v.string(),
    requestId: v.string(),
    mode: v.union(v.literal("upc"), v.literal("name")),
    periodKey: v.string(),
    plan: v.union(v.literal("free"), v.literal("pro")),
    status: v.union(v.literal("reserved"), v.literal("succeeded"), v.literal("refunded")),
    countsTowardQuota: v.boolean(),
    value: v.optional(v.union(v.string(), v.null())),
    format: v.optional(v.string()),
    errorCode: v.optional(v.union(
      v.literal("upstream-failed"),
      v.literal("upstream-timeout"),
      v.literal("invalid-input"),
      v.literal("upstream-rate-limited"),
    )),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerkUserId_and_createdAt", ["clerkUserId", "createdAt"])
    .index("by_clerkUserId_and_periodKey_and_plan_and_countsTowardQuota", ["clerkUserId", "periodKey", "plan", "countsTowardQuota"])
    .index("by_requestId", ["requestId"]),

  usageSessions: defineTable({
    usageSessionId: v.string(),
    browserSessionId: v.optional(v.string()),
    ownerType: v.union(v.literal("anonymous"), v.literal("user")),
    anonymousId: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    // Historical session values remain valid; new sessions use trial or subscription.
    accessSource: v.union(v.literal("trial"), v.literal("complimentary"), v.literal("subscription")),
    startedAt: v.number(),
    lastConnectedAt: v.number(),
    disconnectedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    endedReason: v.optional(
      v.union(v.literal("explicit_disconnect"), v.literal("disconnected_timeout"), v.literal("max_duration")),
    ),
    consumedAt: v.number(),
  })
    .index("by_usageSessionId", ["usageSessionId"])
    .index("by_anonymousId", ["anonymousId"])
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_disconnectedAt", ["disconnectedAt"])
    .index("by_endedAt", ["endedAt"]),

  storeKitTransactions: defineTable({
    transactionId: v.string(),
    originalTransactionId: v.string(),
    clerkUserId: v.string(),
    appAccountToken: v.string(),
    productId: v.string(),
    environment: v.string(),
    purchaseDate: v.number(),
    expiresDate: v.number(),
    revocationDate: v.optional(v.number()),
    signedDate: v.optional(v.number()),
    source: v.union(v.literal("client"), v.literal("notification")),
    updatedAt: v.number(),
  })
    .index("by_transactionId", ["transactionId"])
    .index("by_originalTransactionId", ["originalTransactionId"])
    .index("by_clerkUserId", ["clerkUserId"]),

  storeKitNotifications: defineTable({
    notificationUUID: v.string(),
    notificationType: v.string(),
    subtype: v.optional(v.string()),
    signedDate: v.optional(v.number()),
    transactionId: v.optional(v.string()),
    receivedAt: v.number(),
  }).index("by_notificationUUID", ["notificationUUID"]),

  scannerJoinTokens: defineTable({
    token: v.string(),
    sessionId: v.string(),
    browserClaim: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    graceExpiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    rotatedTo: v.optional(v.string()),
    usageSessionId: v.optional(v.string()),
    anonymousId: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_graceExpiresAt", ["graceExpiresAt"]),

  scannerJoinAttempts: defineTable({
    token: v.string(),
    attemptId: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    status: v.union(
      v.literal("waiting_for_offer"),
      v.literal("offer_posted"),
      v.literal("answer_posted"),
      v.literal("expired"),
    ),
    contributorId: v.optional(v.string()),
    deviceLabel: v.optional(v.string()),
    protocolVersion: v.optional(v.string()),
    capabilities: v.optional(v.array(v.string())),
    offer: v.optional(v.string()),
    answer: v.optional(v.string()),
    offeredAt: v.optional(v.number()),
    answeredAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_token_and_status", ["token", "status"])
    .index("by_token_and_attemptId", ["token", "attemptId"])
    .index("by_expiresAt", ["expiresAt"]),

  scannerPairings: defineTable({
    pairingId: v.string(),
    secret: v.string(),
    browserSessionId: v.string(),
    status: v.union(v.literal("active"), v.literal("expired")),
    displayName: v.optional(v.string()),
    phoneDeviceId: v.optional(v.string()),
    phoneLabel: v.optional(v.string()),
    pushSubscription: v.optional(pushSubscription),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_pairingId", ["pairingId"])
    .index("by_browserSessionId", ["browserSessionId"])
    .index("by_browserSessionId_and_status", ["browserSessionId", "status"])
    .index("by_expiresAt", ["expiresAt"]),

  // Retired tables are kept only so the one-time purge can run.
  // Drop these permissive definitions in a follow-up after verifying the purge.
  catalogActivityDays: defineTable(v.any()),
  catalogImportControl: defineTable(v.any()),
  catalogImportRuns: defineTable(v.any()),
  catalogImportProgress: defineTable(v.any()),
  catalogImportCursors: defineTable(v.any()),
  paymoreCatalogProducts: defineTable(v.any()),
  paymoreCatalogSources: defineTable(v.any()),
  productApiUsage: defineTable(v.any()),
  productApiRequests: defineTable(v.any()),
  catalogObservations: defineTable(v.any()),
  productApiKeys: defineTable(v.any()),
  productApiAccess: defineTable(v.any()),
  productApiRateLimits: defineTable(v.any()),

  webBillingCustomers: defineTable({
    ownerClerkUserId: v.string(), ownerTokenIdentifier: v.string(), stripeCustomerId: v.string(), createdAt: v.number(),
    workspaceCheckout: v.optional(v.object({ requestKey: v.string(), expiresAt: v.number(), sessionId: v.optional(v.string()), url: v.optional(v.string()) })),
    // Accept existing checkout reservations until historical billing rows are migrated.
    apiCheckout: v.optional(v.object({ requestKey: v.string(), expiresAt: v.number(), sessionId: v.optional(v.string()), url: v.optional(v.string()) })),
  }).index("by_ownerClerkUserId", ["ownerClerkUserId"]).index("by_stripeCustomerId", ["stripeCustomerId"]),
  // Historical billing ledger values remain valid; new billing operations accept workspace only.
  webSubscriptions: defineTable({
    ownerClerkUserId: v.string(), ownerTokenIdentifier: v.string(), product: v.union(v.literal("workspace"), v.literal("api")),
    stripeCustomerId: v.string(), stripeSubscriptionId: v.string(),
    status: v.union(v.literal("active"), v.literal("past_due"), v.literal("canceled"), v.literal("unpaid"), v.literal("incomplete"), v.literal("incomplete_expired"), v.literal("trialing"), v.literal("paused")),
    currentPeriodEnd: v.number(), paidThrough: v.optional(v.number()), cancelAtPeriodEnd: v.boolean(), endedAt: v.optional(v.number()), updatedAt: v.number(), lastEventCreated: v.number(),
  }).index("by_ownerClerkUserId_and_product", ["ownerClerkUserId", "product"])
    .index("by_ownerTokenIdentifier_and_product", ["ownerTokenIdentifier", "product"])
    .index("by_stripeSubscriptionId", ["stripeSubscriptionId"]),
  webBillingEvents: defineTable({ eventId: v.string(), eventCreated: v.number(), processedAt: v.number() }).index("by_eventId", ["eventId"]),
  scannerReconnectRequests: defineTable({
    pairingId: v.string(),
    requestId: v.string(),
    browserSessionId: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    status: v.union(v.literal("waiting_for_browser"), v.literal("join_window_ready"), v.literal("expired")),
    joinUrl: v.optional(v.string()),
    joinToken: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    answeredAt: v.optional(v.number()),
  })
    .index("by_pairingId", ["pairingId"])
    .index("by_pairingId_and_requestId", ["pairingId", "requestId"])
    .index("by_browserSessionId", ["browserSessionId"])
    .index("by_browserSessionId_and_status", ["browserSessionId", "status"])
    .index("by_expiresAt", ["expiresAt"]),
  // TestFlight testers flag OCR captures that parsed badly. The photo lives in R2 under
  // `objectKey`; these rows keep everything the recognizer saw so parsing can be replayed.
  ocrFlags: defineTable({
    flagId: v.string(),
    workspaceId: v.id("workspaces"),
    sourceDeviceId: v.string(),
    objectKey: v.string(),
    contentType: v.string(),
    byteCount: v.number(),
    status: v.union(v.literal("uploading"), v.literal("ready")),
    selectedRawText: v.string(),
    selectedCleanedText: v.optional(v.string()),
    regions: v.array(v.object({
      text: v.string(),
      confidence: v.number(),
      isDeviceIdentifier: v.boolean(),
      x: v.number(),
      y: v.number(),
      width: v.number(),
      height: v.number(),
    })),
    rawRegionTexts: v.array(v.string()),
    appVersion: v.optional(v.string()),
    appBuild: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
    uploadedAt: v.optional(v.number()),
  })
    .index("by_flagId", ["flagId"])
    .index("by_sourceDeviceId_and_createdAt", ["sourceDeviceId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  // A signed-out iPhone asks signed-in Chrome for a one-time sign-in QR.
  // Secrets are stored only as SHA-256 hashes.
  mobileSignInRequests: defineTable({
    requestSecretHash: v.string(),
    emailHash: v.string(),
    // Unset when the email matched no eligible account; such a request can
    // never be redeemed, but looks the same to the phone.
    clerkUserId: v.optional(v.string()),
    mfaRequired: v.optional(v.boolean()),
    qrCodeHash: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("expired"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_requestSecretHash", ["requestSecretHash"])
    .index("by_emailHash_and_createdAt", ["emailHash", "createdAt"])
    .index("by_clerkUserId_and_status", ["clerkUserId", "status"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"])
    .index("by_createdAt", ["createdAt"]),
});
