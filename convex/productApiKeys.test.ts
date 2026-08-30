import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";

import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./productApiKeyCrypto";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type KeyMetadata = {
  id: Id<"productApiKeys">;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

type CreatedKey = KeyMetadata & { token: string };

type AuthorizationResult =
  | { kind: "authorized"; limit: number; remaining: number; resetAt: number }
  | { kind: "invalid_key" }
  | {
      kind: "rate_limited";
      limit: number;
      remaining: number;
      resetAt: number;
      retryAfterSeconds: number;
    };

const listKeys = makeFunctionReference<"query", Record<string, never>, KeyMetadata[]>(
  "productApiKeys:list",
);
const createKey = makeFunctionReference<"mutation", { name: string }, CreatedKey>(
  "productApiKeys:create",
);
const revokeKey = makeFunctionReference<"mutation", { id: Id<"productApiKeys"> }, KeyMetadata>(
  "productApiKeys:revoke",
);
const authenticateAndConsume = makeFunctionReference<
  "mutation",
  { keyHash: string; now: number },
  AuthorizationResult
>("productApiKeys:authenticateAndConsume");

function asUser(t: ReturnType<typeof convexTest>, tokenIdentifier: string) {
  return t.withIdentity({ subject: tokenIdentifier, tokenIdentifier });
}

describe("product API key lifecycle", () => {
  test("requires Clerk authentication for list, create, and revoke", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(listKeys, {})).rejects.toThrow(/Not authenticated/);
    await expect(t.mutation(createKey, { name: "CLI" })).rejects.toThrow(/Not authenticated/);

    const created = await asUser(t, "clerk|owner").mutation(createKey, { name: "CLI" });
    await expect(t.mutation(revokeKey, { id: created.id })).rejects.toThrow(/Not authenticated/);
  });

  test("returns plaintext once and stores only its SHA-256 hash and display prefix", async () => {
    const t = convexTest(schema, modules);
    const owner = asUser(t, "clerk|owner");
    const created = await owner.mutation(createKey, { name: "  Warehouse sync  " });

    expect(created.name).toBe("Warehouse sync");
    expect(created.token).toMatch(/^volt_pd_[a-f0-9]{48}$/);
    expect(created.prefix).toBe(created.token.slice(0, 16));

    const row = await t.run(async (ctx) => ctx.db.get(created.id));
    expect(row).toMatchObject({
      ownerTokenIdentifier: "clerk|owner",
      name: "Warehouse sync",
      keyHash: await sha256Hex(created.token),
      prefix: created.prefix,
      status: "active",
    });
    expect(row).not.toHaveProperty("token");
    expect(row).not.toHaveProperty("key");

    const listed = await owner.query(listKeys, {});
    expect(listed).toEqual([{
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      createdAt: created.createdAt,
      lastUsedAt: null,
      revokedAt: null,
    }]);
    expect(listed[0]).not.toHaveProperty("token");
  });

  test("isolates owners and prevents cross-owner revocation", async () => {
    const t = convexTest(schema, modules);
    const firstOwner = asUser(t, "clerk|first");
    const secondOwner = asUser(t, "clerk|second");
    const firstKey = await firstOwner.mutation(createKey, { name: "First" });
    const secondKey = await secondOwner.mutation(createKey, { name: "Second" });

    expect((await firstOwner.query(listKeys, {})).map((key) => key.id)).toEqual([firstKey.id]);
    expect((await secondOwner.query(listKeys, {})).map((key) => key.id)).toEqual([secondKey.id]);
    await expect(secondOwner.mutation(revokeKey, { id: firstKey.id })).rejects.toThrow(/not found/i);
  });

  test("revokes a key and rejects it on later API requests", async () => {
    const t = convexTest(schema, modules);
    const owner = asUser(t, "clerk|owner");
    const created = await owner.mutation(createKey, { name: "Revoke me" });
    const keyHash = await sha256Hex(created.token);

    expect(await t.mutation(authenticateAndConsume, { keyHash, now: 1_700_000_000_000 }))
      .toMatchObject({ kind: "authorized", remaining: 119 });
    const revoked = await owner.mutation(revokeKey, { id: created.id });
    expect(revoked.revokedAt).not.toBeNull();
    expect(await t.mutation(authenticateAndConsume, { keyHash, now: 1_700_000_000_001 }))
      .toEqual({ kind: "invalid_key" });
  });

  test("rejects an unknown API key hash", async () => {
    const t = convexTest(schema, modules);
    const keyHash = await sha256Hex(`volt_pd_${"0".repeat(48)}`);
    expect(await t.mutation(authenticateAndConsume, { keyHash, now: 1_700_000_000_000 }))
      .toEqual({ kind: "invalid_key" });
  });

  test("allows 120 requests in a fixed minute and rejects request 121", async () => {
    const t = convexTest(schema, modules);
    const created = await asUser(t, "clerk|owner").mutation(createKey, { name: "Rate test" });
    const keyHash = await sha256Hex(created.token);
    const now = 1_700_000_020_000;

    let lastResult: AuthorizationResult = { kind: "invalid_key" };
    for (let requestNumber = 1; requestNumber <= 120; requestNumber += 1) {
      lastResult = await t.mutation(authenticateAndConsume, { keyHash, now });
    }
    expect(lastResult).toMatchObject({ kind: "authorized", limit: 120, remaining: 0 });

    const rejected = await t.mutation(authenticateAndConsume, { keyHash, now });
    expect(rejected).toMatchObject({
      kind: "rate_limited",
      limit: 120,
      remaining: 0,
      retryAfterSeconds: 20,
    });

    const nextWindow = await t.mutation(authenticateAndConsume, {
      keyHash,
      now: 1_700_000_060_000,
    });
    expect(nextWindow).toMatchObject({ kind: "authorized", remaining: 119 });

    const stored = await t.run(async (ctx) => ctx.db.get(created.id));
    expect(stored?.lastUsedAt).toBe(1_700_000_060_000);
  });
});
