import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const ACTION_IDS = new Set([
  "ebay",
  "google-upc",
  "pricecharting",
  "google-search",
  "copy-highlight-link",
  "look-up",
  "ask-gemini",
]);

const settingsValidator = v.object({
  payload: v.string(),
  revision: v.number(),
  updatedAt: v.number(),
});

function validatePayload(payload: string) {
  if (new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES) {
    throw new ConvexError("SETTINGS_TOO_LARGE");
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Settings must be a JSON object");
    }
    const contextMenu = Reflect.get(parsed, "contextMenu");
    if (contextMenu !== undefined) {
      if (contextMenu === null || typeof contextMenu !== "object" || Array.isArray(contextMenu)) {
        throw new Error("Invalid context menu settings");
      }
      for (const key of ["selectionPopupActions", "contextMenuSelectionActions"]) {
        const actions: unknown = Reflect.get(contextMenu, key);
        if (actions === undefined) continue;
        if (!Array.isArray(actions) || actions.length > 3
          || actions.some((id) => typeof id !== "string" || !ACTION_IDS.has(id))
          || new Set(actions).size !== actions.length) {
          throw new Error("Invalid selection actions");
        }
      }
    }
  } catch {
    throw new ConvexError("INVALID_SETTINGS_PAYLOAD");
  }
}

export const get = query({
  args: {},
  returns: v.union(settingsValidator, v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("AUTHENTICATION_REQUIRED");

    const settings = await ctx.db
      .query("extensionSettings")
      .withIndex("by_ownerTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!settings) return null;
    return {
      payload: settings.payload,
      revision: settings.revision,
      updatedAt: settings.updatedAt,
    };
  },
});

export const save = mutation({
  args: {
    payload: v.string(),
    expectedRevision: v.union(v.number(), v.null()),
    expectedSubject: v.string(),
  },
  returns: settingsValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("AUTHENTICATION_REQUIRED");
    if (identity.subject !== args.expectedSubject) {
      throw new ConvexError("SETTINGS_ACCOUNT_CHANGED");
    }
    validatePayload(args.payload);

    const existing = await ctx.db
      .query("extensionSettings")
      .withIndex("by_ownerTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (existing?.revision !== (args.expectedRevision ?? undefined)) {
      throw new ConvexError("SETTINGS_CONFLICT");
    }

    const updatedAt = Date.now();
    const revision = (existing?.revision ?? 0) + 1;
    if (existing) {
      await ctx.db.patch(existing._id, {
        payload: args.payload,
        revision,
        updatedAt,
      });
    } else {
      await ctx.db.insert("extensionSettings", {
        ownerClerkUserId: identity.subject,
        ownerTokenIdentifier: identity.tokenIdentifier,
        payload: args.payload,
        revision,
        updatedAt,
      });
    }
    return { payload: args.payload, revision, updatedAt };
  },
});
