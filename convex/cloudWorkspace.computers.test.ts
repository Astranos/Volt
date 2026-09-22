import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { COMPUTER_PAGE_SIZE, LEGACY_COMPUTER_DOCUMENT_LIMIT, type ComputerPage } from "./cloudWorkspace/devices";
import { enroll, guestGrant, modules, restoreWorkspaceTestEnvironment } from "./cloudWorkspace.testSupport";

afterEach(restoreWorkspaceTestEnvironment);

async function seed(count: number) {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const t = convexTest(schema, modules);
  const owner = await enroll(t, "computer-page-owner");
  await t.run(async ctx => {
    const workspace = await ctx.db.query("workspaces").unique();
    if (!workspace) throw new Error("Missing workspace");
    for (let index = 0; index < count; index++) {
      await ctx.db.insert("workspaceDevices", {
        workspaceId: workspace._id, deviceId: `computer-${index}`, credentialHash: "unused", kind: "chrome",
        label: `Desk ${index}`, createdAt: 1, lastSeenAt: 1,
      });
      await ctx.db.insert("workspacePresence", {
        workspaceId: workspace._id, deviceId: `computer-${index}`, state: "online", capabilities: ["Cursor-Insertion"],
        lastSeenAt: 100_000, expiresAt: 200_000,
      });
    }
    await ctx.db.insert("workspaceDevices", {
      workspaceId: workspace._id, deviceId: "revoked", credentialHash: "unused", kind: "chrome",
      label: "Revoked", createdAt: 1, lastSeenAt: 1, revokedAt: 2,
    });
    for (let index = 0; index < 1000; index++) await ctx.db.insert("workspacePresence", {
      workspaceId: workspace._id, deviceId: `unrelated-${index}`, state: "offline", capabilities: [], lastSeenAt: 1, expiresAt: 1,
    });
  });
  return { t, owner };
}

test("computer pages return every active Chrome device without collecting unrelated presence", async () => {
  const count = COMPUTER_PAGE_SIZE * 2 + 3;
  const { t, owner } = await seed(count);
  const grant = await guestGrant(t, "computer-page-owner");
  const all: ComputerPage["computers"] = [];
  let cursor: string | null = null;
  do {
    const page: ComputerPage = await owner.signedIn.query(api.cloudWorkspace.listComputersPage, { cursor });
    expect(page.computers.length).toBeLessThanOrEqual(COMPUTER_PAGE_SIZE);
    expect(page.computers.every(computer => computer.online && computer.lastSeenAt === 100_000)).toBe(true);
    all.push(...page.computers);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);
  expect(all.map(computer => computer.deviceId)).toEqual(Array.from({ length: count }, (_, index) => `computer-${index}`));

  for (const read of [
    (cursor: string | null) => t.query(api.cloudWorkspace.listComputersForDevicePage, { ...owner.credential, cursor }),
    (cursor: string | null) => t.query(api.cloudWorkspace.listComputersForGuestPage, { guestCloudGrant: grant.guestCloudGrant, cursor }),
  ]) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await read(cursor);
      expect(page.computers.every(computer => computer.capabilities[0] === "cursor-insertion" && !("lastSeenAt" in computer))).toBe(true);
      ids.push(...page.computers.map(computer => computer.deviceId));
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor !== null);
    expect(ids).toEqual(all.map(computer => computer.deviceId));
  }
});

test("legacy computer lists reject over-budget workspaces while pages and HTTP drains stay complete", async () => {
  const count = LEGACY_COMPUTER_DOCUMENT_LIMIT + 1;
  const { t, owner } = await seed(count);
  const grant = await guestGrant(t, "computer-page-owner");
  await expect(owner.signedIn.query(api.cloudWorkspace.listComputers, {})).rejects.toThrow(/requires pagination/);
  await expect(t.query(api.cloudWorkspace.listComputersForDevice, owner.credential)).rejects.toThrow(/requires pagination/);
  await expect(t.query(api.cloudWorkspace.listComputersForGuest, { guestCloudGrant: grant.guestCloudGrant })).rejects.toThrow(/requires pagination/);

  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page: ComputerPage = await owner.signedIn.query(api.cloudWorkspace.listComputersPage, { cursor });
    ids.push(...page.computers.map(computer => computer.deviceId));
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);
  expect(ids).toEqual(Array.from({ length: count }, (_, index) => `computer-${index}`));

  const mobile = await t.fetch("/api/mobile/computers/list", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(owner.credential),
  });
  expect(mobile.status).toBe(200);
  const payload = await mobile.json();
  expect(payload.computers.map((computer: { deviceId: string }) => computer.deviceId))
    .toEqual(Array.from({ length: count }, (_, index) => `computer-${index}`));
});

test("computer cursors are bound to workspace and credential principal and reauthorize every page", async () => {
  const { t, owner } = await seed(COMPUTER_PAGE_SIZE + 1);
  const other = await enroll(t, "another-computer-owner");
  const secondDevice = await enroll(t, "computer-page-owner");
  const page = await t.query(api.cloudWorkspace.listComputersForDevicePage, { ...owner.credential, cursor: null });
  await expect(t.query(api.cloudWorkspace.listComputersForDevicePage, { ...other.credential, cursor: page.continueCursor }))
    .rejects.toThrow(/another workspace or principal/);
  await expect(t.query(api.cloudWorkspace.listComputersForDevicePage, { ...secondDevice.credential, cursor: page.continueCursor }))
    .rejects.toThrow(/another workspace or principal/);
  await expect(owner.signedIn.query(api.cloudWorkspace.listComputersPage, { cursor: page.continueCursor }))
    .rejects.toThrow(/another workspace or principal/);
  await owner.signedIn.mutation(api.cloudWorkspace.revokeDevice, { deviceId: owner.credential.deviceId });
  await expect(t.query(api.cloudWorkspace.listComputersForDevicePage, { ...owner.credential, cursor: page.continueCursor }))
    .rejects.toThrow(/revoked device credential/);
});

test("device byte budgets create additional pages without dropping large labels", async () => {
  const { t, owner } = await seed(6);
  const label = "x".repeat(90_000);
  await t.run(async ctx => {
    const devices = await ctx.db.query("workspaceDevices").collect();
    for (const device of devices) if (device.deviceId.startsWith("computer-")) await ctx.db.patch(device._id, { label });
  });
  let cursor: string | null = null;
  let total = 0;
  let pages = 0;
  do {
    const page: ComputerPage = await owner.signedIn.query(api.cloudWorkspace.listComputersPage, { cursor });
    expect(page.computers.length).toBeLessThanOrEqual(2);
    expect(page.computers.every(computer => computer.label === label)).toBe(true);
    total += page.computers.length;
    pages++;
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);
  expect(total).toBe(6);
  expect(pages).toBeGreaterThan(1);
});

test("HTTP device and App Clip lists drain pages while preserving complete legacy payloads", async () => {
  const count = COMPUTER_PAGE_SIZE * 2 + 3;
  const { t, owner } = await seed(count);
  const grant = await guestGrant(t, "computer-page-owner");
  const computers = Array.from({ length: count }, (_, index) => ({
    deviceId: `computer-${index}`, label: `Desk ${index}`, capabilities: ["cursor-insertion"], online: true,
  }));
  const mobile = await t.fetch("/api/mobile/computers/list", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(owner.credential),
  });
  expect(mobile.status).toBe(200);
  expect(await mobile.json()).toEqual({ cursorTargetDeviceId: null, computers });
  const clip = await t.fetch("/api/app-clip/computers/list", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestCloudGrant: grant.guestCloudGrant }),
  });
  expect(clip.status).toBe(200);
  expect(await clip.json()).toEqual({ computers });
});
