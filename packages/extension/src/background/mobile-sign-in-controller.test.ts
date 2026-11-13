import { beforeEach, expect, test, vi } from "vitest";
import {
  MOBILE_SIGN_IN_NOTIFICATION_PREFIX,
  createMobileSignInController,
  parseSignInRequests,
} from "./mobile-sign-in-controller";

const id = "test-extension";
const now = 1_000_000;
let session: Record<string, unknown>;
let notifications: Map<string, Record<string, unknown>>;
let broadcasts: unknown[];
let windows: { url?: unknown; type?: unknown; focused?: unknown }[];
let offscreen: unknown[];

function chromeApi() {
  return {
    runtime: {
      id,
      getURL: (path: string) => `chrome-extension://${id}${path}`,
      sendMessage: vi.fn(async (message: unknown) => { broadcasts.push(message); }),
    },
    storage: {
      session: {
        get: async (key: string) => (key in session ? { [key]: session[key] } : {}),
        set: async (values: Record<string, unknown>) => { Object.assign(session, values); },
      },
    },
    notifications: {
      create: vi.fn(async (notificationId: string, options: Record<string, unknown>) => {
        notifications.set(notificationId, options);
        return notificationId;
      }),
      clear: vi.fn(async (notificationId: string) => notifications.delete(notificationId)),
    },
    windows: { create: vi.fn(async (data: { url?: unknown; type?: unknown; focused?: unknown }) => { windows.push(data); return {}; }) },
  } as unknown as typeof chrome;
}

function setup() {
  return createMobileSignInController({
    chromeApi: chromeApi(),
    sendOffscreenMessage: async (message) => {
      offscreen.push(message);
      return { success: true, value: { qrCodeUrl: "https://voltresale.app/app-sign-in#code=abc", expiresAt: now + 1000 } };
    },
    log: () => {},
    now: () => now,
  });
}

const request = (requestId: string, extra: Record<string, unknown> = {}) => ({ requestId, createdAt: now, expiresAt: now + 60_000, mfaRequired: false, ...extra });

beforeEach(() => {
  session = {};
  notifications = new Map();
  broadcasts = [];
  windows = [];
  offscreen = [];
});

test("each pending request gets one notification, cleared when the request closes", async () => {
  const controller = setup();
  await controller.handleRequests([request("r1")]);
  expect([...notifications.keys()]).toEqual([`${MOBILE_SIGN_IN_NOTIFICATION_PREFIX}r1`]);

  // A dismissed notification is not shown again on the next update.
  notifications.clear();
  await controller.handleRequests([request("r1"), request("r2")]);
  expect([...notifications.keys()]).toEqual([`${MOBILE_SIGN_IN_NOTIFICATION_PREFIX}r2`]);

  await controller.handleRequests([]);
  expect(notifications.size).toBe(0);
  expect(broadcasts).toEqual([
    { action: "mobileSignInRequestClosed", requestId: "r1" },
    { action: "mobileSignInRequestClosed", requestId: "r2" },
  ]);
});

test("expired or malformed requests are ignored", () => {
  expect(parseSignInRequests([
    request("ok"),
    request("old", { expiresAt: now }),
    { requestId: 5, expiresAt: now + 1 },
    null,
  ], now).map((item) => item.requestId)).toEqual(["ok"]);
  expect(parseSignInRequests("nope", now)).toEqual([]);
});

test("clicking the notification opens the QR window for that request only", async () => {
  const controller = setup();
  await controller.handleRequests([request("r1")]);
  expect(await controller.handleNotificationClicked("someone-else")).toBe(false);
  expect(await controller.handleNotificationClicked(`${MOBILE_SIGN_IN_NOTIFICATION_PREFIX}r1`)).toBe(true);
  expect(notifications.size).toBe(0);
  expect(windows).toHaveLength(1);
  expect(windows[0]).toMatchObject({ type: "popup", focused: true });
  expect(new URL(String(windows[0].url)).pathname).toBe("/mobile-sign-in-popup.html");
  expect(new URL(String(windows[0].url)).searchParams.get("requestId")).toBe("r1");
});

test("only the sign-in window can ask for a QR code", async () => {
  const controller = setup();
  const send = (message: unknown, page: string) => new Promise((resolve) => {
    expect(controller.handleMessage(message, { id, url: `chrome-extension://${id}${page}` }, resolve)).toBe(true);
  });
  expect(await send({ action: "mobileSignInIssueQr", requestId: "r1" }, "/newtab.html"))
    .toEqual({ success: false, error: "unauthorized_extension_sender" });
  expect(offscreen).toEqual([]);
  expect(await send({ action: "mobileSignInIssueQr", requestId: "r1" }, "/mobile-sign-in-popup.html"))
    .toMatchObject({ success: true, value: { qrCodeUrl: expect.any(String) } });
  await send({ action: "mobileSignInDismiss", requestId: "r1" }, "/mobile-sign-in-popup.html");
  expect(offscreen).toEqual([
    { action: "workspaceOffscreenIssueMobileSignInQr", requestId: "r1" },
    { action: "workspaceOffscreenDismissMobileSignIn", requestId: "r1" },
  ]);
  expect(controller.handleMessage({ action: "unrelated" }, { id }, () => {})).toBe(false);
});
