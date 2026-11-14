import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const email = "owner@example.com";
const userId = "user_owner123";
let user: Record<string, unknown>;
let users: unknown[];
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", "server-secret");
  user = { id: userId, banned: false, locked: false, two_factor_enabled: false, email_addresses: [{ email_address: email, verification: { status: "verified" } }] };
  users = [user];
  fetchMock.mockReset().mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.clerk.com/v1/users?")) {
      const requested = new URL(url).searchParams.get("email_address");
      return Response.json(requested === email ? users : []);
    }
    if (url === `https://api.clerk.com/v1/users/${userId}`) return Response.json(user);
    if (url === "https://api.clerk.com/v1/sign_in_tokens") return Response.json({ token: "one-use-ticket", user_id: userId, status: "pending" });
    throw new Error(`unexpected URL ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function post(t: ReturnType<typeof convexTest>, path: string, body: unknown) {
  return t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function requestSignIn(t: ReturnType<typeof convexTest>, address = email) {
  const response = await post(t, "/api/mobile/sign-in/request", { email: address });
  expect(response.status).toBe(200);
  const body = await response.json() as { requestSecret: string; expiresAt: number };
  expect(Object.keys(body).sort()).toEqual(["expiresAt", "requestSecret"]);
  return body.requestSecret;
}

function codeFrom(qrCodeUrl: string) {
  const url = new URL(qrCodeUrl);
  // Distributed iOS binaries still trust this host; branding is served through the legacy web alias.
  expect(`${url.origin}${url.pathname}`).toBe("https://voltresale.app/app-sign-in");
  expect(url.search).toBe("");
  return new URLSearchParams(url.hash.slice(1)).get("code")!;
}

function ticketMints() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/sign_in_tokens")).length;
}

test("the phone that asked can redeem the QR Chrome shows, exactly once", async () => {
  const t = convexTest(schema, modules);
  const requestSecret = await requestSignIn(t, "  Owner@Example.com ");
  const chrome = t.withIdentity({ subject: userId });
  const [pending] = await chrome.query(api.mobileSignIn.pendingForComputer, {});
  expect(pending).toMatchObject({ mfaRequired: false });

  const { qrCodeUrl } = await chrome.mutation(api.mobileSignIn.issueQr, { requestId: pending.requestId });
  const code = codeFrom(qrCodeUrl);
  const redeemed = await post(t, "/api/mobile/sign-in/redeem", { requestSecret, code });
  expect(redeemed.status).toBe(200);
  expect(await redeemed.json()).toEqual({ ticket: "one-use-ticket" });
  expect(await chrome.query(api.mobileSignIn.pendingForComputer, {})).toEqual([]);

  const again = await post(t, "/api/mobile/sign-in/redeem", { requestSecret, code });
  expect(again.status).toBe(410);
  expect(ticketMints()).toBe(1);
});

test("a QR code is useless without the requesting phone's secret", async () => {
  const t = convexTest(schema, modules);
  await requestSignIn(t);
  const chrome = t.withIdentity({ subject: userId });
  const [pending] = await chrome.query(api.mobileSignIn.pendingForComputer, {});
  const code = codeFrom((await chrome.mutation(api.mobileSignIn.issueQr, { requestId: pending.requestId })).qrCodeUrl);

  const otherPhone = await requestSignIn(t, "someone-else@example.com");
  expect((await post(t, "/api/mobile/sign-in/redeem", { requestSecret: otherPhone, code })).status).toBe(403);
  expect((await post(t, "/api/mobile/sign-in/redeem", { requestSecret: "made-up", code })).status).toBe(410);
  expect(ticketMints()).toBe(0);
});

test("unknown emails get the same answer and notify nobody", async () => {
  const t = convexTest(schema, modules);
  const requestSecret = await requestSignIn(t, "nobody@example.com");
  expect(await t.withIdentity({ subject: userId }).query(api.mobileSignIn.pendingForComputer, {})).toEqual([]);
  const response = await post(t, "/api/mobile/sign-in/redeem", { requestSecret, code: "guess" });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "invalid_code" });
});

test("reopening the QR replaces the previous code", async () => {
  const t = convexTest(schema, modules);
  const requestSecret = await requestSignIn(t);
  const chrome = t.withIdentity({ subject: userId });
  const [pending] = await chrome.query(api.mobileSignIn.pendingForComputer, {});
  const first = codeFrom((await chrome.mutation(api.mobileSignIn.issueQr, { requestId: pending.requestId })).qrCodeUrl);
  const second = codeFrom((await chrome.mutation(api.mobileSignIn.issueQr, { requestId: pending.requestId })).qrCodeUrl);
  expect((await post(t, "/api/mobile/sign-in/redeem", { requestSecret, code: first })).status).toBe(403);
  expect((await post(t, "/api/mobile/sign-in/redeem", { requestSecret, code: second })).status).toBe(200);
});

test("another account's Chrome cannot see or answer the request", async () => {
  const t = convexTest(schema, modules);
  await requestSignIn(t);
  const [pending] = await t.withIdentity({ subject: userId }).query(api.mobileSignIn.pendingForComputer, {});
  const stranger = t.withIdentity({ subject: "user_stranger" });
  expect(await stranger.query(api.mobileSignIn.pendingForComputer, {})).toEqual([]);
  await expect(stranger.mutation(api.mobileSignIn.issueQr, { requestId: pending.requestId })).rejects.toThrow(/SIGN_IN_REQUEST_CLOSED/);
});

test("dismissing in Chrome closes the request", async () => {
  const t = convexTest(schema, modules);
  const requestSecret = await requestSignIn(t);
  const chrome = t.withIdentity({ subject: userId });
  const [pending] = await chrome.query(api.mobileSignIn.pendingForComputer, {});
  const code = codeFrom((await chrome.mutation(api.mobileSignIn.issueQr, { requestId: pending.requestId })).qrCodeUrl);
  await chrome.mutation(api.mobileSignIn.dismiss, { requestId: pending.requestId });
  expect(await chrome.query(api.mobileSignIn.pendingForComputer, {})).toEqual([]);
  expect((await post(t, "/api/mobile/sign-in/redeem", { requestSecret, code })).status).toBe(410);
});

test("two-factor accounts are told to use normal sign-in and never get a ticket", async () => {
  user.two_factor_enabled = true;
  const t = convexTest(schema, modules);
  await requestSignIn(t);
  const chrome = t.withIdentity({ subject: userId });
  const [pending] = await chrome.query(api.mobileSignIn.pendingForComputer, {});
  expect(pending.mfaRequired).toBe(true);
  await expect(chrome.mutation(api.mobileSignIn.issueQr, { requestId: pending.requestId })).rejects.toThrow(/SIGN_IN_MFA_REQUIRED/);
});

test("an account locked after the QR was shown is refused at redemption", async () => {
  const t = convexTest(schema, modules);
  const requestSecret = await requestSignIn(t);
  const chrome = t.withIdentity({ subject: userId });
  const [pending] = await chrome.query(api.mobileSignIn.pendingForComputer, {});
  const code = codeFrom((await chrome.mutation(api.mobileSignIn.issueQr, { requestId: pending.requestId })).qrCodeUrl);
  user.locked = true;
  const response = await post(t, "/api/mobile/sign-in/redeem", { requestSecret, code });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "account_not_allowed" });
  expect(ticketMints()).toBe(0);
});

test("requests per email are rate limited", async () => {
  const t = convexTest(schema, modules);
  for (let index = 0; index < 3; index += 1) await requestSignIn(t);
  const limited = await post(t, "/api/mobile/sign-in/request", { email });
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "too_many_requests" });
});

test("a global budget stops rotating emails before Clerk is called", async () => {
  const t = convexTest(schema, modules);
  for (let index = 0; index < 30; index += 1) await requestSignIn(t, `person${index}@example.com`);
  const clerkCalls = fetchMock.mock.calls.length;
  const limited = await post(t, "/api/mobile/sign-in/request", { email: "another@example.com" });
  expect(limited.status).toBe(429);
  expect(limited.headers.get("Retry-After")).toBe("60");
  expect(fetchMock.mock.calls.length).toBe(clerkCalls);
  expect(await t.run(async (ctx) => (await ctx.db.query("mobileSignInRequests").collect()).length)).toBe(30);
});

test("invalid emails are rejected before touching Clerk", async () => {
  const t = convexTest(schema, modules);
  const response = await post(t, "/api/mobile/sign-in/request", { email: "not-an-email" });
  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("expired requests are swept and cannot be redeemed", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const requestSecret = await requestSignIn(t);
  const chrome = t.withIdentity({ subject: userId });
  const [pending] = await chrome.query(api.mobileSignIn.pendingForComputer, {});
  const code = codeFrom((await chrome.mutation(api.mobileSignIn.issueQr, { requestId: pending.requestId })).qrCodeUrl);
  vi.advanceTimersByTime(5 * 60 * 1000 + 1);
  expect(await t.mutation(internal.mobileSignIn.sweep, {})).toEqual({ expired: 1, deleted: 0 });
  expect(await chrome.query(api.mobileSignIn.pendingForComputer, {})).toEqual([]);
  expect((await post(t, "/api/mobile/sign-in/redeem", { requestSecret, code })).status).toBe(410);
});
