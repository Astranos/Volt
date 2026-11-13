import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { retiredTables } from "./catalogPurge";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

test("purges retired tables in bounded scheduled batches and can be restarted", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const customerId = await t.run(async (ctx) => {
    for (const table of retiredTables) {
      for (let i = 0; i < 215; i++) {
        await ctx.db.insert(table, { legacyField: `fixture-${i}` });
      }
    }
    return ctx.db.insert("webBillingCustomers", {
      ownerClerkUserId: "alice",
      ownerTokenIdentifier: "clerk|alice",
      stripeCustomerId: "cus_alice",
      createdAt: Date.now(),
    });
  });

  await t.mutation(internal.catalogPurge.purge, {});
  expect(await t.run((ctx) => ctx.db.query(retiredTables[0]).collect())).toHaveLength(115);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  await t.run(async (ctx) => {
    for (const table of retiredTables) {
      expect(await ctx.db.query(table).first()).toBeNull();
    }
    expect(await ctx.db.get(customerId)).toMatchObject({ stripeCustomerId: "cus_alice" });
  });

  await t.mutation(internal.catalogPurge.purge, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.get(customerId))).not.toBeNull();
});
