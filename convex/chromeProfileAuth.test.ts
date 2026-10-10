import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const extensionId = "a".repeat(32);
const clientId = "123-test.apps.googleusercontent.com";
const subject = "1234567890";
const email = "mi03@paymore.com";
const userId = "user_test123";
let google: Record<string, unknown>;
let googleUser: Record<string, unknown>;
let user: Record<string, unknown>;
let users: unknown;
let ticket: Record<string, unknown>;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv("GOOGLE_CHROME_EXTENSION_CLIENT_ID", clientId);
  vi.stubEnv("CHROME_EXTENSION_ID", extensionId);
  vi.stubEnv("CLERK_SECRET_KEY", "server-secret");
  google = { audience: clientId, issued_to: clientId, expires_in: 120, user_id: subject, email, verified_email: true };
  googleUser = { id: subject, email, verified_email: true };
  user = { id: userId, banned: false, locked: false, two_factor_enabled: false, email_addresses: [{ email_address: email, verification: { status: "verified" } }], external_accounts: [{ provider: "oauth_google", provider_user_id: subject, email_address: email, verification: { status: "verified" } }] };
  users = [user];
  ticket = { token: "one-use-ticket", user_id: userId, status: "pending" };
  fetchMock.mockReset().mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("https://www.googleapis.com/oauth2/v2/tokeninfo?")) return Response.json(google);
    if (url === "https://www.googleapis.com/oauth2/v2/userinfo") return Response.json(googleUser);
    if (url.startsWith("https://api.clerk.com/v1/users?")) return Response.json(users);
    if (url === "https://api.clerk.com/v1/sign_in_tokens") return Response.json(ticket);
    throw new Error("unexpected URL");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function request(options: { body?: string; origin?: string; token?: string } = {}) {
  return convexTest(schema, modules).fetch("/auth/chrome-profile", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.token ?? "google-token"}`, ...(options.origin === undefined ? {} : { Origin: options.origin }) },
    body: options.body ?? JSON.stringify({ googleSubject: subject }),
  });
}
async function rejects(code: string, status: number) {
  const response = await request();
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ code });
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("sign_in_tokens"))).toBe(false);
}
test("exchanges only a verified linked Google profile for a 60 second Clerk ticket", async () => {
  const response = await request({ origin: `chrome-extension://${extensionId}` });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ticket: "one-use-ticket", userId });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("access-control-allow-origin")).toBe(`chrome-extension://${extensionId}`);
  expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "POST", body: JSON.stringify({ user_id: userId, expires_in_seconds: 60 }) });
  expect(fetchMock.mock.calls[2][0]).toBe(`https://api.clerk.com/v1/users?email_address=mi03%40paymore.com&limit=2`);
});
test("fails closed without server configuration and rejects foreign browser origins before upstream calls", async () => {
  const response = await request({ origin: "https://evil.test" });
  expect(response.status).toBe(403);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  vi.stubEnv("GOOGLE_CHROME_EXTENSION_CLIENT_ID", "");
  await rejects("not_configured", 503);
  expect(fetchMock).not.toHaveBeenCalled();
});
test("preflights allow only the configured extension", async () => {
  const t = convexTest(schema, modules);
  const response = await t.fetch("/auth/chrome-profile", { method: "OPTIONS", headers: { Origin: `chrome-extension://${extensionId}` } });
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe(`chrome-extension://${extensionId}`);
  expect(fetchMock).not.toHaveBeenCalled();
});
test.each(["not-json", JSON.stringify({ googleSubject: subject, email }), JSON.stringify({ googleSubject: "" }), " ".repeat(1025)])("rejects malformed or excessive request bodies", async (body) => {
  expect((await request({ body })).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
test.each([
  { audience: "other.apps.googleusercontent.com" }, { issued_to: "other.apps.googleusercontent.com" },
  { expires_in: 0 }, { expires_in: "120" }, { verified_email: false }, { user_id: "" },
])("rejects invalid Google token claims %j", async (claims) => {
  Object.assign(google, claims);
  await rejects("invalid_google_token", 401);
});
test("the expected Chrome profile subject must match the authenticated Google subject", async () => {
  google.user_id = "999";
  await rejects("profile_mismatch", 403);
});
test.each([{ id: "999" }, { email: "mi01@paymore.com" }, { verified_email: false }])("requires consistent verified Google userinfo %j", async (claims) => {
  Object.assign(googleUser, claims);
  await rejects("invalid_google_token", 401);
});
test.each([0, 2])("rejects missing or ambiguous existing Clerk accounts", async (count) => {
  users = Array.from({ length: count }, () => user);
  await rejects("account_not_linked", 403);
});
test("email alone cannot claim an existing Clerk account", async () => {
  user.external_accounts = [{ provider: "oauth_google", provider_user_id: "999", email_address: email, verification: { status: "verified" } }];
  await rejects("account_not_linked", 403);
});
test("unverified Clerk email or Google external account cannot be adopted", async () => {
  user.email_addresses = [{ email_address: email, verification: { status: "unverified" } }];
  await rejects("account_not_linked", 403);
});
test.each(["banned", "locked"])("rejects %s users", async (field) => {
  user[field] = true;
  await rejects("account_not_allowed", 403);
});
test("MFA accounts must use normal Clerk sign-in", async () => {
  user.two_factor_enabled = true;
  await rejects("mfa_required", 403);
});
test("missing account restriction flags fail closed", async () => {
  delete user.locked;
  await rejects("upstream_unavailable", 503);
});
test("upstream errors are sanitized and never return credentials", async () => {
  fetchMock.mockRejectedValue(new Error("google-token server-secret"));
  await rejects("upstream_unavailable", 503);
});
test("Google invalid token HTTP responses return retryable credential errors", async () => {
  fetchMock.mockResolvedValue(new Response("invalid_token", { status: 401 }));
  await rejects("invalid_google_token", 401);
});
test("ticket responses for another user cannot be redeemed", async () => {
  ticket.user_id = "user_other";
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "upstream_unavailable" });
});

test("email verification handles addresses containing s and rejects whitespace", async () => {
  google.email = "store@paymore.com";
  googleUser.email = "store@paymore.com";
  user.email_addresses = [{ email_address: "store@paymore.com", verification: { status: "verified" } }];
  user.external_accounts = [{ provider: "oauth_google", provider_user_id: subject, email_address: "store@paymore.com", verification: { status: "verified" } }];
  expect((await request()).status).toBe(200);
  fetchMock.mockClear();
  google.email = "store @paymore.com";
  await rejects("invalid_google_token", 401);
});
test("rejects Google links without verified status", async () => {
  user.external_accounts = [{ provider: "oauth_google", provider_user_id: subject, email_address: email, verification: { status: "unverified" } }];
  await rejects("account_not_linked", 403);
});
test("does not mistake application external IDs for Google provider subjects", async () => {
  user.external_accounts = [{ provider: "oauth_google", external_id: subject, email_address: email, verification: { status: "verified" } }];
  await rejects("account_not_linked", 403);
});
test("excessive upstream JSON is rejected before a ticket is minted", async () => {
  fetchMock.mockResolvedValue(Response.json({ huge: "x".repeat(128 * 1024) }));
  await rejects("upstream_unavailable", 503);
});
