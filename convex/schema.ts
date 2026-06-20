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
  scannerJoinTokens: defineTable({
    token: v.string(),
    sessionId: v.string(),
    browserClaim: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    graceExpiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    rotatedTo: v.optional(v.string()),
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
