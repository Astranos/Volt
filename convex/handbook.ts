import { ConvexError, v } from "convex/values";

import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  authenticatedWorkspaceOrNull,
  requireOrCreateAuthenticatedWorkspace,
} from "./cloudWorkspace/identity";
import {
  handbookContentFields,
  handbookCredentialsValidator,
  handbookFieldValidator,
  handbookKindValidator,
  handbookValueFormatValidator,
  handbookVariantValidator,
  type HandbookContent,
  type HandbookCredentials,
} from "./handbookValidators";
import { decryptToken, encryptToken } from "./shopifyHelpers";

// The handbook is account-scoped: it lives in the signed-in account's Cloud
// Scanner Workspace, the only tenancy boundary Volt has. Coworkers on separate
// accounts do not share entries.

// Bounds what a full list read can return: MAX_ENTRIES * MAX_ENTRY_BYTES stays well
// under Convex's per-function read limit.
const MAX_ENTRIES = 300;
const MAX_ENTRY_BYTES = 16_000;
const LIMITS = {
  title: 120,
  category: 40,
  // Shown with the title. Room for anything older extensions could save (a 200-character
  // short note plus a 10,000-character note) once folded together.
  note: 12_000,
  value: 2_000,
  body: 10_000,
  page: 15_000,
  variants: 4,
  fields: 8,
  fieldLabel: 40,
  variantLabel: 40,
  steps: 40,
  stepText: 1_000,
  keys: 8,
  key: 24,
  command: 1_000,
  tip: 500,
  username: 200,
  secret: 500,
};
const MASK = "••••••";

const entryValidator = v.object({
  _id: v.id("handbookEntries"),
  kind: handbookKindValidator,
  title: v.string(),
  category: v.string(),
  note: v.optional(v.string()),
  value: v.optional(v.string()),
  valueFormat: v.optional(handbookValueFormatValidator),
  fields: v.optional(v.array(handbookFieldValidator)),
  body: v.optional(v.string()),
  showInList: v.optional(v.boolean()),
  variants: v.optional(v.array(handbookVariantValidator)),
  pinned: v.boolean(),
  order: v.number(),
  secretPreview: v.optional(v.string()),
  // A login's username, shown in full; the password is only ever returned by revealSecret.
  username: v.optional(v.string()),
  updatedAt: v.number(),
  updatedByName: v.string(),
});

function authorName(identity: { name?: string; givenName?: string; email?: string }) {
  return identity.name ?? identity.givenName ?? identity.email ?? "Volt user";
}

function text(value: string | undefined, max: number, field: string, required = false) {
  const trimmed = value?.trim() ?? "";
  if (required && !trimmed) throw new ConvexError(`HANDBOOK_${field}_REQUIRED`);
  if (trimmed.length > max) throw new ConvexError(`HANDBOOK_${field}_TOO_LONG`);
  return trimmed || undefined;
}

// Normalizes editor input and enforces each kind's required content.
function cleanContent(content: HandbookContent): HandbookContent {
  const variants = content.kind === "guide"
    ? (content.variants ?? []).map((variant) => ({
      label: text(variant.label, LIMITS.variantLabel, "VARIANT_LABEL") ?? "",
      warning: text(variant.warning, LIMITS.tip, "WARNING"),
      steps: variant.steps.map((step) => {
        const keys = (step.keys ?? []).map((key) => text(key, LIMITS.key, "KEY")).filter((key) => key !== undefined);
        if (keys.length > LIMITS.keys) throw new ConvexError("HANDBOOK_KEYS_TOO_MANY");
        return {
          text: text(step.text, LIMITS.stepText, "STEP", true) ?? "",
          keys: keys.length ? keys : undefined,
          command: text(step.command, LIMITS.command, "COMMAND"),
          tip: text(step.tip, LIMITS.tip, "TIP"),
        };
      }),
    }))
    : undefined;
  if (variants) {
    if (!variants.length || variants.some((variant) => !variant.steps.length)) {
      throw new ConvexError("HANDBOOK_STEPS_REQUIRED");
    }
    if (variants.length > LIMITS.variants) throw new ConvexError("HANDBOOK_VARIANTS_TOO_MANY");
    if (variants.some((variant) => variant.steps.length > LIMITS.steps)) throw new ConvexError("HANDBOOK_STEPS_TOO_MANY");
  }
  // A value entry is one or more labeled values. A single unlabeled value keeps the
  // original shape (no `fields`); otherwise `value`/`valueFormat` mirror the first field.
  const fields = content.kind === "value"
    ? (content.fields?.length ? content.fields : [{ value: content.value ?? "", format: content.valueFormat }]).map((field) => ({
      label: text(field.label, LIMITS.fieldLabel, "FIELD_LABEL"),
      value: text(field.value, LIMITS.value, "VALUE", true) ?? "",
      format: field.format,
    }))
    : undefined;
  if (fields && fields.length > LIMITS.fields) throw new ConvexError("HANDBOOK_FIELDS_TOO_MANY");
  // Quick values and logins no longer have notes (longer write-ups are pages). Notes sent
  // by older extensions are folded into the short note, keeping their line breaks. If the
  // folded note wouldn't fit, the notes are kept as they are (and still shown) rather than
  // failing a save that used to work.
  const foldsNotes = content.kind === "value" || content.kind === "secret";
  const folded = foldsNotes && content.body?.trim() ? mergeNotes(content.note, content.body) : undefined;
  const build = (fold: boolean) => ({
    kind: content.kind,
    title: text(content.title, LIMITS.title, "TITLE", true) ?? "",
    category: text(content.category, LIMITS.category, "CATEGORY", true) ?? "",
    note: text(fold ? folded : content.note, LIMITS.note, "NOTE"),
    value: fields?.[0].value,
    // An explicit "text" is kept so a client's choice overrides title-based inference.
    valueFormat: fields?.[0].format,
    fields: fields && (fields.length > 1 || fields[0].label) ? fields : undefined,
    body: content.kind === "page"
      ? text(content.body, LIMITS.page, "PAGE", true)
      : fold ? undefined : text(content.body, LIMITS.body, "BODY"),
    showInList: content.kind === "page" && content.showInList ? true : undefined,
    variants,
    pinned: content.pinned,
  });
  const fits = (entry: object) => new TextEncoder().encode(JSON.stringify(entry)).length <= MAX_ENTRY_BYTES;
  if (folded !== undefined && folded.length <= LIMITS.note) {
    const cleaned = build(true);
    if (fits(cleaned)) return cleaned;
  }
  const cleaned = build(false);
  if (!fits(cleaned)) throw new ConvexError("HANDBOOK_ENTRY_TOO_LARGE");
  return cleaned;
}

/** A short note followed by former notes, keeping their line breaks (so it never grows longer). */
function mergeNotes(note: string | undefined, body: string) {
  return [note?.trim(), body.trim()].filter(Boolean).join("\n");
}

/**
 * One-time move of existing notes on quick values and logins into their short note, a
 * page of entries at a time. Run after deploying: first with `'{}'`, then with
 * `'{"cursor":"<continueCursor>"}'` from each result until `isDone` is true. Check that
 * `skipped` is 0; a skipped entry keeps its notes, which stay shown as "Older notes".
 * An entry whose merged note wouldn't fit is skipped (and counted), never truncated.
 */
export const moveNotesIntoShortNotes = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ moved: v.number(), skipped: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("handbookEntries").paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let moved = 0;
    let skipped = 0;
    for (const entry of page.page) {
      if ((entry.kind !== "value" && entry.kind !== "secret") || !entry.body?.trim()) continue;
      const note = mergeNotes(entry.note, entry.body);
      const fits = note.length <= LIMITS.note
        && new TextEncoder().encode(JSON.stringify({ ...entry, note, body: undefined })).length <= MAX_ENTRY_BYTES;
      if (!fits) {
        skipped++;
        continue;
      }
      await ctx.db.patch(entry._id, { note, body: undefined });
      moved++;
    }
    return { moved, skipped, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * Extensions released before value formats or fields existed send only `value` (and
 * maybe no format). Keep the saved format and the other fields instead of letting
 * their edit erase them; their edited value replaces the first field.
 */
function keepNewerValueShape(input: HandbookContent, entry: Doc<"handbookEntries">): HandbookContent {
  if (input.fields !== undefined) return input;
  if (!entry.fields?.length) return { ...input, valueFormat: input.valueFormat ?? entry.valueFormat };
  // An older client shows the saved format and only guesses one from the title when none
  // is saved. So a format that differs from a saved one is a deliberate change; a guess
  // (nothing saved) doesn't override the first field.
  const [first, ...rest] = entry.fields;
  const format = entry.valueFormat !== undefined && input.valueFormat !== undefined && input.valueFormat !== entry.valueFormat
    ? input.valueFormat
    : first.format;
  return { ...input, valueFormat: format, fields: [{ ...first, value: input.value ?? first.value, format }, ...rest] };
}

/**
 * An older client turning a multi-value entry into a page only moves the first value
 * into the page. Add the other values as "Label: value" lines so none is lost.
 */
function keepValuesInPage(input: HandbookContent, entry: Doc<"handbookEntries">): HandbookContent {
  const extra = (entry.fields ?? []).slice(1)
    .map((field) => (field.label ? `${field.label}: ${field.value}` : field.value))
    .filter((line) => !(input.body ?? "").split("\n").some((existing) => existing.trim() === line));
  return extra.length ? { ...input, body: [input.body, extra.join("\n")].filter(Boolean).join("\n\n") } : input;
}

type Login = { username?: string; secret: string };

// Passwords are stored exactly as typed; only an all-whitespace password counts as blank.
// A blank username or password falls back to the saved one, when there is one.
function cleanCredentials(credentials: HandbookCredentials, saved: Login | null = null): Login {
  const secret = credentials.secret.trim() ? credentials.secret : saved?.secret;
  if (!secret) throw new ConvexError("HANDBOOK_SECRET_REQUIRED");
  if (secret.length > LIMITS.secret) throw new ConvexError("HANDBOOK_SECRET_TOO_LONG");
  return { username: text(credentials.username, LIMITS.username, "USERNAME") ?? saved?.username, secret };
}

// Shows enough of a username to tell logins apart, and nothing of the secret.
export function maskedSecretPreview(username: string | undefined) {
  if (!username) return MASK;
  const visible = Math.min(4, Math.floor(username.length / 3));
  return `${username.slice(0, visible)}••• · ${MASK}`;
}

function toSummary(entry: Doc<"handbookEntries">, username?: string) {
  return {
    _id: entry._id,
    kind: entry.kind,
    title: entry.title,
    category: entry.category,
    note: entry.note,
    value: entry.value,
    valueFormat: entry.valueFormat,
    fields: entry.fields,
    body: entry.body,
    showInList: entry.showInList,
    variants: entry.variants,
    pinned: entry.pinned,
    order: entry.order,
    secretPreview: entry.secretPreview,
    username,
    updatedAt: entry.updatedAt,
    updatedByName: entry.updatedByName,
  };
}

async function requireEditor(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("AUTHENTICATION_REQUIRED");
  const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
  return { workspace, updatedByName: authorName(identity) };
}

async function requireOwnedEntry(ctx: MutationCtx, workspaceId: Id<"workspaces">, entryId: Id<"handbookEntries">) {
  const entry = await ctx.db.get(entryId);
  // Another account's entry is reported exactly like a missing one.
  if (!entry || entry.workspaceId !== workspaceId) throw new ConvexError("HANDBOOK_ENTRY_NOT_FOUND");
  return entry;
}

async function secretFor(ctx: Pick<QueryCtx, "db">, entryId: Id<"handbookEntries">) {
  return await ctx.db.query("handbookSecrets").withIndex("by_entryId", (q) => q.eq("entryId", entryId)).unique();
}

async function nextOrder(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const last = await ctx.db
    .query("handbookEntries")
    .withIndex("by_workspaceId_and_order", (q) => q.eq("workspaceId", workspaceId))
    .order("desc")
    .first();
  return (last?.order ?? -1) + 1;
}

async function assertCapacity(ctx: MutationCtx, workspaceId: Id<"workspaces">, adding: number) {
  const existing = await ctx.db
    .query("handbookEntries")
    .withIndex("by_workspaceId_and_order", (q) => q.eq("workspaceId", workspaceId))
    .take(MAX_ENTRIES);
  if (existing.length + adding > MAX_ENTRIES) throw new ConvexError("HANDBOOK_FULL");
}

// Logins are encrypted at rest with the server's token key. The workspace and entry
// are bound in as associated data, so a ciphertext can't be replayed onto another entry.
const secretContext = (workspaceId: Id<"workspaces">, entryId: Id<"handbookEntries">) =>
  `handbook:${workspaceId}:${entryId}`;

/**
 * A login's username for display, or undefined. Only the username is decrypted, and a
 * row that can't be read hides that one username instead of failing the whole list.
 */
async function readUsername(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, entryId: Id<"handbookEntries">) {
  const stored = await secretFor(ctx, entryId);
  if (!stored || stored.workspaceId !== workspaceId || stored.username === undefined) return undefined;
  try {
    return await decryptToken(stored.username, secretContext(workspaceId, entryId));
  } catch {
    return undefined;
  }
}

async function readSecret(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, entryId: Id<"handbookEntries">) {
  const stored = await secretFor(ctx, entryId);
  if (!stored || stored.workspaceId !== workspaceId) return null;
  const context = secretContext(workspaceId, entryId);
  return {
    username: stored.username === undefined ? undefined : await decryptToken(stored.username, context),
    secret: await decryptToken(stored.secret, context),
  };
}

async function writeSecret(ctx: MutationCtx, workspaceId: Id<"workspaces">, entryId: Id<"handbookEntries">, login: Login) {
  const context = secretContext(workspaceId, entryId);
  const row = {
    workspaceId,
    entryId,
    username: login.username === undefined ? undefined : await encryptToken(login.username, context),
    secret: await encryptToken(login.secret, context),
  };
  const existing = await secretFor(ctx, entryId);
  if (existing) await ctx.db.replace(existing._id, row);
  else await ctx.db.insert("handbookSecrets", row);
}

/**
 * Every entry in the account's handbook. Secret entries carry only a masked preview.
 * Pages are left out unless `includePages` is set, so extensions released before pages
 * existed (which call this with no arguments) never see an entry kind they can't show.
 */
export const list = query({
  args: { includePages: v.optional(v.boolean()) },
  returns: v.array(entryValidator),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("AUTHENTICATION_REQUIRED");
    const workspace = await authenticatedWorkspaceOrNull(ctx);
    if (!workspace) return [];
    const entries = await ctx.db
      .query("handbookEntries")
      .withIndex("by_workspaceId_and_order", (q) => q.eq("workspaceId", workspace._id))
      .take(MAX_ENTRIES);
    const shown = entries.filter((entry) => args.includePages || entry.kind !== "page");
    // Usernames are decrypted for display; passwords never leave revealSecret.
    return await Promise.all(shown.map(async (entry) => toSummary(
      entry,
      entry.kind === "secret" ? await readUsername(ctx, workspace._id, entry._id) : undefined,
    )));
  },
});

// Every entry could have its own category.
const MAX_CATEGORIES = MAX_ENTRIES;

/** The account's chosen category order (possibly empty). */
export const categoryOrder = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("AUTHENTICATION_REQUIRED");
    const workspace = await authenticatedWorkspaceOrNull(ctx);
    if (!workspace) return [];
    const saved = await ctx.db
      .query("handbookCategoryOrders")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .unique();
    return saved?.categories ?? [];
  },
});

/** Saves the order categories are shown in, everywhere the handbook appears. */
export const setCategoryOrder = mutation({
  args: { categories: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireEditor(ctx);
    const categories = args.categories.map((category) => text(category, LIMITS.category, "CATEGORY", true) ?? "");
    if (categories.length > MAX_CATEGORIES || new Set(categories).size !== categories.length) {
      throw new ConvexError("HANDBOOK_INVALID_ORDER");
    }
    const saved = await ctx.db
      .query("handbookCategoryOrders")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .unique();
    if (saved) await ctx.db.patch(saved._id, { categories });
    else await ctx.db.insert("handbookCategoryOrders", { workspaceId: workspace._id, categories });
    return null;
  },
});

/**
 * Returns one secret entry's login. A mutation rather than a query so the value
 * is fetched on demand and never sits in a reactive query cache.
 */
export const revealSecret = mutation({
  args: { id: v.id("handbookEntries") },
  returns: v.object({ username: v.optional(v.string()), secret: v.string() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("AUTHENTICATION_REQUIRED");
    const workspace = await authenticatedWorkspaceOrNull(ctx);
    if (!workspace) throw new ConvexError("HANDBOOK_ENTRY_NOT_FOUND");
    const entry = await requireOwnedEntry(ctx, workspace._id, args.id);
    const login = entry.kind === "secret" ? await readSecret(ctx, workspace._id, entry._id) : null;
    if (!login) throw new ConvexError("HANDBOOK_SECRET_NOT_FOUND");
    return login.username === undefined ? { secret: login.secret } : login;
  },
});

export const create = mutation({
  args: { ...handbookContentFields, credentials: v.optional(handbookCredentialsValidator) },
  returns: v.id("handbookEntries"),
  handler: async (ctx, { credentials, ...input }) => {
    const { workspace, updatedByName } = await requireEditor(ctx);
    const content = cleanContent(input);
    const login = content.kind === "secret"
      ? cleanCredentials(credentials ?? { secret: "" })
      : null;
    await assertCapacity(ctx, workspace._id, 1);
    const now = Date.now();
    const id = await ctx.db.insert("handbookEntries", {
      workspaceId: workspace._id,
      ...content,
      order: await nextOrder(ctx, workspace._id),
      secretPreview: login ? maskedSecretPreview(login.username) : undefined,
      createdAt: now,
      updatedAt: now,
      updatedByName,
    });
    if (login) await writeSecret(ctx, workspace._id, id, login);
    return id;
  },
});

/**
 * Replaces an entry's content. Omit `credentials` to keep a secret entry's login;
 * a blank username or password inside `credentials` keeps that saved part.
 */
export const update = mutation({
  args: {
    id: v.id("handbookEntries"),
    ...handbookContentFields,
    credentials: v.optional(handbookCredentialsValidator),
  },
  returns: v.null(),
  handler: async (ctx, { id, credentials, ...input }) => {
    const { workspace, updatedByName } = await requireEditor(ctx);
    const entry = await requireOwnedEntry(ctx, workspace._id, id);
    // Extensions released before value formats existed don't send one; keep the saved format
    // instead of letting their edit erase a phone or address choice.
    const content = cleanContent(
      input.kind === "value" && entry.kind === "value" ? keepNewerValueShape(input, entry)
        : input.kind === "page" && entry.kind === "value" && input.fields === undefined ? keepValuesInPage(input, entry)
          : input,
    );
    const existingSecret = await secretFor(ctx, id);
    let secretPreview: string | undefined;
    if (content.kind === "secret") {
      if (credentials) {
        const login = cleanCredentials(credentials, await readSecret(ctx, workspace._id, id));
        await writeSecret(ctx, workspace._id, id, login);
        secretPreview = maskedSecretPreview(login.username);
      } else if (existingSecret) {
        secretPreview = entry.secretPreview;
      } else {
        throw new ConvexError("HANDBOOK_SECRET_REQUIRED");
      }
    } else if (existingSecret) {
      await ctx.db.delete(existingSecret._id);
    }
    await ctx.db.replace(id, {
      workspaceId: workspace._id,
      ...content,
      order: entry.order,
      secretPreview,
      starterKey: entry.starterKey,
      createdAt: entry.createdAt,
      updatedAt: Date.now(),
      updatedByName,
    });
    return null;
  },
});

export const setPinned = mutation({
  args: { id: v.id("handbookEntries"), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireEditor(ctx);
    await requireOwnedEntry(ctx, workspace._id, args.id);
    await ctx.db.patch(args.id, { pinned: args.pinned });
    return null;
  },
});

/** Stores the given order. Entries left out keep their position values. */
export const reorder = mutation({
  args: { ids: v.array(v.id("handbookEntries")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.ids.length > MAX_ENTRIES || new Set(args.ids).size !== args.ids.length) {
      throw new ConvexError("HANDBOOK_INVALID_ORDER");
    }
    const { workspace } = await requireEditor(ctx);
    const entries = await Promise.all(args.ids.map((id) => requireOwnedEntry(ctx, workspace._id, id)));
    const slots = entries.map((entry) => entry.order).sort((a, b) => a - b);
    await Promise.all(entries.map((entry, index) => ctx.db.patch(entry._id, { order: slots[index] })));
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("handbookEntries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireEditor(ctx);
    await requireOwnedEntry(ctx, workspace._id, args.id);
    const secret = await secretFor(ctx, args.id);
    if (secret) await ctx.db.delete(secret._id);
    await ctx.db.delete(args.id);
    return null;
  },
});

// Defaults that apply to any store. Store-specific details (phone, address,
// local police, logins) are never seeded; the editor offers them as blanks.
const STARTER_ENTRIES: Array<HandbookContent & { starterKey: string }> = [
  {
    starterKey: "skip-windows-sign-in",
    kind: "guide",
    title: "Skip Windows sign-in",
    category: "Setup guides",
    body: "For Windows: no password.",
    pinned: true,
    variants: [
      {
        label: "New method (24H2+)",
        warning: "If the command does nothing, the build is too old. Switch to Older builds.",
        steps: [
          { text: "On the region / keyboard screen, don't connect to Wi-Fi." },
          {
            text: "Open Command Prompt.",
            keys: ["Shift", "Fn", "F10"],
            tip: "Fn is only needed on laptops where the F-keys are media keys.",
          },
          { text: "Type this command and press Enter.", command: "start ms-cxh:localonly" },
          { text: "Create a local user named \"User\" with no password, then finish setup." },
        ],
      },
      {
        label: "Older builds",
        steps: [
          { text: "Before the internet screen, open Command Prompt.", keys: ["Shift", "F10"] },
          { text: "Type this in all caps and press Enter.", command: "OOBE\\BYPASSNRO" },
          { text: "The PC restarts. Go through setup as normal." },
          { text: "On the internet screen, click \"I don't have internet\", then \"Continue with limited setup\"." },
        ],
      },
    ],
  },
];

/** Adds the starter entries this account does not already have. */
export const addStarterEntries = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const { workspace, updatedByName } = await requireEditor(ctx);
    const missing = [];
    for (const starter of STARTER_ENTRIES) {
      const existing = await ctx.db
        .query("handbookEntries")
        .withIndex("by_workspaceId_and_starterKey", (q) =>
          q.eq("workspaceId", workspace._id).eq("starterKey", starter.starterKey))
        .first();
      if (!existing) missing.push(starter);
    }
    await assertCapacity(ctx, workspace._id, missing.length);
    let order = await nextOrder(ctx, workspace._id);
    const now = Date.now();
    for (const { starterKey, ...content } of missing) {
      await ctx.db.insert("handbookEntries", {
        workspaceId: workspace._id,
        ...cleanContent(content),
        order: order++,
        starterKey,
        createdAt: now,
        updatedAt: now,
        updatedByName,
      });
    }
    return missing.length;
  },
});
