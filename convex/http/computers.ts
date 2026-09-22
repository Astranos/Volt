import { makeFunctionReference } from "convex/server";
import { httpAction } from "../_generated/server";
import type { DeviceComputerPage, GuestComputerPage } from "../cloudWorkspace/devices";
import { signalBodyFromRequest, stringFrom } from "../scannerSignal/httpAdapter";
import { emptyResponse, jsonResponse } from "./shared";

const devicePage = makeFunctionReference<"query", {
  deviceId: string; deviceSecret: string; cursor: string | null;
}, DeviceComputerPage>("cloudWorkspace:listComputersForDevicePage");
const guestPage = makeFunctionReference<"query", {
  guestCloudGrant: string; cursor: string | null;
}, GuestComputerPage>("cloudWorkspace:listComputersForGuestPage");

async function allComputers<Page extends GuestComputerPage>(read: (cursor: string | null) => Promise<Page>) {
  const computers = new Map<string, GuestComputerPage["computers"][number]>();
  let cursor: string | null = null;
  let workspaceId: string | undefined;
  while (true) {
    const page: Page = await read(cursor);
    if (workspaceId !== undefined && workspaceId !== page.workspaceId) throw new Error("Workspace changed during computer pagination");
    workspaceId = page.workspaceId;
    for (const computer of page.computers) computers.set(computer.deviceId, computer);
    if (page.isDone) return { ...page, computers: [...computers.values()] };
    if (!page.continueCursor || page.continueCursor === cursor) throw new Error("Computer pagination did not advance");
    cursor = page.continueCursor;
  }
}

export const mobileComputerListHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const deviceId = stringFrom(body.deviceId, 120);
  const deviceSecret = stringFrom(body.deviceSecret, 240);
  if (!deviceId || !deviceSecret) return jsonResponse({ error: "Missing device credentials" }, 400);
  const page = await allComputers(cursor => ctx.runQuery(devicePage, { deviceId, deviceSecret, cursor }));
  return jsonResponse({ cursorTargetDeviceId: page.cursorTargetDeviceId, computers: page.computers });
});

export const appClipComputerListHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const body = await signalBodyFromRequest(request);
  const guestCloudGrant = stringFrom(body.guestCloudGrant, 240);
  if (!guestCloudGrant) return jsonResponse({ error: "Missing guest cloud grant" }, 400);
  const page = await allComputers(cursor => ctx.runQuery(guestPage, { guestCloudGrant, cursor }));
  return jsonResponse({ computers: page.computers });
});
