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
const CUSTOM_ACTION_ICON_NAME = /^[a-z0-9-]{1,80}$/;

function isCustomSelectionAction(value: unknown): value is {
  kind: "custom";
  id: string;
  label: string;
  iconName: string;
  iconCodepoint: number;
  url: string;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const kind = Reflect.get(value, "kind");
  const id = Reflect.get(value, "id");
  const label = Reflect.get(value, "label");
  const iconName = Reflect.get(value, "iconName");
  const iconCodepoint = Reflect.get(value, "iconCodepoint");
  const url = Reflect.get(value, "url");
  if (kind !== "custom"
    || typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)
    || typeof label !== "string" || label.trim().length === 0 || label.length > 48
    || typeof iconName !== "string" || !CUSTOM_ACTION_ICON_NAME.test(iconName)
    || typeof iconCodepoint !== "number" || !Number.isInteger(iconCodepoint)
    || iconCodepoint < 0xf0000 || iconCodepoint > 0xfffff
    || typeof url !== "string" || url.length === 0 || url.length > 2048) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    return (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
      && parsedUrl.username.length === 0
      && parsedUrl.password.length === 0;
  } catch {
    return false;
  }
}

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
        if (!Array.isArray(actions) || actions.length > 3) {
          throw new Error("Invalid selection actions");
        }
        const actionKeys = new Set<string>();
        const actionValues: unknown[] = actions;
        for (const action of actionValues) {
          const actionKey = typeof action === "string" && ACTION_IDS.has(action)
            ? action
            : isCustomSelectionAction(action) ? action.id : null;
          if (actionKey === null || actionKeys.has(actionKey)) {
            throw new Error("Invalid selection actions");
          }
          actionKeys.add(actionKey);
        }
      }
    }
  } catch {
    throw new ConvexError("INVALID_SETTINGS_PAYLOAD");
  }
}

export const get = query({
  args: {},
  returns: v.object({ subject: v.string(), value: v.union(settingsValidator, v.null()) }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("AUTHENTICATION_REQUIRED");

    const settings = await ctx.db
      .query("extensionSettings")
      .withIndex("by_ownerTokenIdentifier", (q) =>
        q.eq("ownerTokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!settings) return { subject: identity.subject, value: null };
    return {
      subject: identity.subject,
      value: {
        payload: settings.payload,
        revision: settings.revision,
        updatedAt: settings.updatedAt,
      },
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
