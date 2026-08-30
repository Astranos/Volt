import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const pushSubscription = v.object({
  endpoint: v.string(),
  expirationTime: v.optional(v.union(v.number(), v.null())),
  keys: v.object({
    auth: v.string(),
    p256dh: v.string(),
  }),
});

export default defineSchema({
  workspaces: defineTable({
    ownerClerkUserId: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerClerkUserId", ["ownerClerkUserId"]),

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
    createdAt: v.number(),
    lastSeenAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_deviceId", ["deviceId"])
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
    .index("by_workspaceId", ["workspaceId"]),

  dictationDrafts: defineTable({
    workspaceId: v.id("workspaces"),
    draftId: v.string(),
    sourceDeviceId: v.string(),
    targetDeviceId: v.string(),
    text: v.string(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_workspaceId_and_draftId", ["workspaceId", "draftId"])
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
    checksum: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    clientCreatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_workspaceId_and_batchId", ["workspaceId", "batchId"])
    .index("by_workspaceId_and_resultId", ["workspaceId", "resultId"]),

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

  // Pro handed out by an admin from the web dashboard. Kept separate from
  // `entitlements` so the grant survives independently of the derived
  // entitlement row that `access.ts` syncs on every status check.
  compedGrants: defineTable({
    // Exactly one of these identifies the target. An email grant lets an admin
    // comp somebody who has not signed into the app yet.
    email: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("revoked")),
    grantedByClerkUserId: v.string(),
    grantedByEmail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_clerkUserId", ["clerkUserId"]),

  organizationEntitlements: defineTable({
    clerkOrganizationId: v.string(),
    displayName: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("inactive")),
    source: v.literal("complimentary"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerkOrganizationId", ["clerkOrganizationId"]),

  usageSessions: defineTable({
    usageSessionId: v.string(),
    browserSessionId: v.optional(v.string()),
    ownerType: v.union(v.literal("anonymous"), v.literal("user")),
    anonymousId: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
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

  paymoreCatalogProducts: defineTable({
    upc: v.string(),
    title: v.string(),
    platform: v.union(v.string(), v.null()),
    edition: v.union(v.string(), v.null()),
    collection: v.union(v.string(), v.null()),
    brand: v.union(v.string(), v.null()),
    model: v.union(v.string(), v.null()),
    mpn: v.union(v.string(), v.null()),
    color: v.union(v.string(), v.null()),
    storage: v.union(v.string(), v.null()),
    carrier: v.union(v.string(), v.null()),
    publisher: v.union(v.string(), v.null()),
    genre: v.union(v.string(), v.null()),
    rating: v.union(v.string(), v.null()),
    releaseYear: v.union(v.string(), v.null()),
    attributes: v.record(v.string(), v.string()),
    collections: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_upc", ["upc"])
    .index("by_title", ["title"])
    .index("by_mpn", ["mpn"])
    .searchIndex("search_title", { searchField: "title" }),

  paymoreCatalogSources: defineTable({
    productId: v.id("paymoreCatalogProducts"),
    upc: v.string(),
    sourceUrl: v.string(),
    condition: v.union(v.string(), v.null()),
    listingAttributes: v.record(v.string(), v.string()),
    createdAt: v.number(),
    // Per-listing facts captured from the listing API. Optional because the
    // table already holds many legacy rows and the HTML crawl path never
    // produces them.
    price: v.optional(v.number()),
    quantity: v.optional(v.number()),
    storeName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_sourceUrl", ["sourceUrl"])
    .index("by_productId", ["productId"])
    .index("by_upc", ["upc"]),

  productApiKeys: defineTable(v.union(
    v.object({
      ownerTokenIdentifier: v.string(),
      name: v.string(),
      keyHash: v.string(),
      prefix: v.string(),
      status: v.literal("active"),
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
    }),
    v.object({
      ownerTokenIdentifier: v.string(),
      name: v.string(),
      keyHash: v.string(),
      prefix: v.string(),
      status: v.literal("revoked"),
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
      revokedAt: v.number(),
    }),
  ))
    .index("by_keyHash", ["keyHash"])
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"])
    .index("by_ownerTokenIdentifier_and_status", ["ownerTokenIdentifier", "status"]),

  productApiRateLimits: defineTable({
    apiKeyId: v.id("productApiKeys"),
    windowStartedAt: v.number(),
    requestCount: v.number(),
    expiresAt: v.number(),
  })
    .index("by_apiKeyId_and_windowStartedAt", ["apiKeyId", "windowStartedAt"])
    .index("by_expiresAt", ["expiresAt"]),

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
});
