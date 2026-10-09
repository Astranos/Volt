import { httpAction } from "../_generated/server";

type ErrorCode = "not_configured" | "invalid_request" | "invalid_google_token" | "profile_mismatch" | "account_not_linked" | "account_not_allowed" | "mfa_required" | "upstream_unavailable";
class ProfileAuthError extends Error {
  constructor(readonly code: ErrorCode, readonly status: number) { super(code); }
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function verified(value: unknown): boolean { return value === true || value === "true"; }

// Bound bodies before parsing, including upstream responses. Never log credentials.
async function readJson(body: ReadableStream<Uint8Array> | null, limit: number): Promise<unknown> {
  if (!body) throw new Error("missing_body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > limit) throw new Error("body_too_large");
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function upstream(url: string, init: RequestInit, google = false): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: "error" });
    if (!response.ok) {
      throw new ProfileAuthError(google && (response.status === 400 || response.status === 401) ? "invalid_google_token" : "upstream_unavailable", google && (response.status === 400 || response.status === 401) ? 401 : 503);
    }
    return await readJson(response.body, 128 * 1024);
  } catch (error) {
    if (error instanceof ProfileAuthError) throw error;
    throw new ProfileAuthError("upstream_unavailable", 503);
  } finally { clearTimeout(timeout); }
}

async function googleIdentity(token: string, clientId: string, expectedSubject: string) {
  const tokenInfo = object(await upstream(`https://www.googleapis.com/oauth2/v2/tokeninfo?access_token=${encodeURIComponent(token)}`, { method: "POST" }, true));
  const expiresIn = tokenInfo.expires_in;
  if (tokenInfo.audience !== clientId || tokenInfo.issued_to !== clientId || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0 || !verified(tokenInfo.verified_email)) {
    throw new ProfileAuthError("invalid_google_token", 401);
  }
  const subject = text(tokenInfo.user_id);
  const email = text(tokenInfo.email).toLowerCase();
  if (!/^[0-9]{1,64}$/.test(subject) || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new ProfileAuthError("invalid_google_token", 401);
  if (subject !== expectedSubject) throw new ProfileAuthError("profile_mismatch", 403);
  const userInfo = object(await upstream("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${token}` } }, true));
  if (userInfo.id !== subject || text(userInfo.email).toLowerCase() !== email || !verified(userInfo.verified_email)) throw new ProfileAuthError("invalid_google_token", 401);
  return { subject, email };
}

async function clerkUser(identity: { subject: string; email: string }, secret: string): Promise<string> {
  const query = new URLSearchParams({ email_address: identity.email, limit: "2" });
  const users = await upstream(`https://api.clerk.com/v1/users?${query}`, { headers: { Authorization: `Bearer ${secret}` } });
  // BAPI returns a raw array; the SDK's paginated wrapper is not the wire format.
  if (!Array.isArray(users)) throw new ProfileAuthError("upstream_unavailable", 503);
  if (users.length !== 1) throw new ProfileAuthError("account_not_linked", 403);
  const user = object(users[0]);
  const userId = text(user.id);
  if (!/^user_[A-Za-z0-9]+$/.test(userId) || typeof user.banned !== "boolean" || typeof user.locked !== "boolean" || typeof user.two_factor_enabled !== "boolean") throw new ProfileAuthError("upstream_unavailable", 503);
  if (user.banned || user.locked) throw new ProfileAuthError("account_not_allowed", 403);
  // Sign-in tickets are privileged credentials. Preserve MFA by using normal Clerk sign-in for these accounts.
  if (user.two_factor_enabled) throw new ProfileAuthError("mfa_required", 403);
  const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
  const accounts = Array.isArray(user.external_accounts) ? user.external_accounts : [];
  const emailVerified = emails.some((value) => {
    const email = object(value);
    return text(email.email_address).toLowerCase() === identity.email && object(email.verification).status === "verified";
  });
  const googleLinked = accounts.some((value) => {
    const account = object(value);
    return account.provider === "oauth_google" && account.provider_user_id === identity.subject && text(account.email_address).toLowerCase() === identity.email && object(account.verification).status === "verified";
  });
  if (!emailVerified || !googleLinked) throw new ProfileAuthError("account_not_linked", 403);
  return userId;
}

export const chromeProfileAuth = httpAction(async (_ctx, request) => {
  const clientId = process.env.GOOGLE_CHROME_EXTENSION_CLIENT_ID?.trim();
  const extensionId = process.env.CHROME_EXTENSION_ID?.trim();
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  const allowedOrigin = extensionId && /^[a-p]{32}$/.test(extensionId) ? `chrome-extension://${extensionId}` : undefined;
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type",
    ...(origin && origin === allowedOrigin ? { "Access-Control-Allow-Origin": origin } : {}),
  };
  const respond = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });
  if (!clientId || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) || !allowedOrigin || !secret) return respond({ code: "not_configured" }, 503);
  // Extension host-permission fetches can omit Origin. Origin is a CORS gate; Google credentials establish identity.
  if (origin && origin !== allowedOrigin) return respond({ code: "invalid_request" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  try {
    const authorization = request.headers.get("Authorization") ?? "";
    const token = /^Bearer ([^\s]{1,4096})$/.exec(authorization)?.[1];
    if (!token || request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") throw new ProfileAuthError("invalid_request", 400);
    let body: Record<string, unknown>;
    try { body = object(await readJson(request.body, 1024)); }
    catch { throw new ProfileAuthError("invalid_request", 400); }
    const googleSubject = text(body.googleSubject);
    if (!/^[0-9]{1,64}$/.test(googleSubject) || Object.keys(body).length !== 1) throw new ProfileAuthError("invalid_request", 400);
    const identity = await googleIdentity(token, clientId, googleSubject);
    const userId = await clerkUser(identity, secret);
    const signInToken = object(await upstream("https://api.clerk.com/v1/sign_in_tokens", {
      method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 60 }),
    }));
    const ticket = text(signInToken.token);
    if (!ticket || ticket.length > 8192 || signInToken.user_id !== userId || signInToken.status !== "pending") throw new ProfileAuthError("upstream_unavailable", 503);
    return respond({ ticket, userId }, 200);
  } catch (error) {
    const failure = error instanceof ProfileAuthError ? error : new ProfileAuthError("upstream_unavailable", 503);
    return respond({ code: failure.code }, failure.status);
  }
});
