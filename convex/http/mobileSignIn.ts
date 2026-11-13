import { makeFunctionReference } from "convex/server";
import { httpAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { randomOpaqueSecret, sha256Hex } from "../cloudWorkspace/identity";
import { normalizedSignInEmail } from "../mobileSignIn";
import { emptyResponse, jsonResponse } from "./shared";
import {
  ClerkBackendError,
  clerkUserEligibility,
  findClerkUserByVerifiedEmail,
  mintSignInTicket,
  readBoundedJson,
} from "./clerkBackend";

const createRequest = makeFunctionReference<
  "mutation",
  { emailHash: string; requestSecretHash: string },
  { limited: false; requestId: Id<"mobileSignInRequests">; expiresAt: number } | { limited: true; retryAfterSeconds: number }
>("mobileSignIn:createRequest");
const attachAccount = makeFunctionReference<
  "mutation",
  { requestId: Id<"mobileSignInRequests">; clerkUserId: string; mfaRequired: boolean },
  null
>("mobileSignIn:attachAccount");
const consume = makeFunctionReference<
  "mutation",
  { requestSecretHash: string; codeHash: string },
  { ok: true; clerkUserId: string } | { ok: false; error: "request_expired" | "invalid_code" }
>("mobileSignIn:consume");

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return null;
  try {
    const body = await readBoundedJson(request.body, 2048);
    return body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function boundedString(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

// POST /api/mobile/sign-in/request { email } -> { requestSecret, expiresAt }
// The response is the same whether or not the email has an account, so the
// endpoint cannot be used to discover who uses Volt.
export const mobileSignInRequestHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) return jsonResponse({ error: "not_configured" }, 503);
  const body = await jsonBody(request);
  const email = normalizedSignInEmail(boundedString(body?.email, 320) ?? "");
  if (!email) return jsonResponse({ error: "invalid_email" }, 400);

  const requestSecret = randomOpaqueSecret();
  const created = await ctx.runMutation(createRequest, {
    emailHash: await sha256Hex(email),
    requestSecretHash: await sha256Hex(requestSecret),
  });
  if (created.limited) {
    return jsonResponse({ error: "too_many_requests" }, 429, { "Retry-After": String(created.retryAfterSeconds) });
  }

  try {
    const account = await findClerkUserByVerifiedEmail(email, secret);
    if (account?.allowed) {
      await ctx.runMutation(attachAccount, {
        requestId: created.requestId,
        clerkUserId: account.userId,
        mfaRequired: account.mfaRequired,
      });
    }
  } catch (error) {
    if (!(error instanceof ClerkBackendError)) throw error;
    // Clerk being down is not a secret; let the phone retry.
    return jsonResponse({ error: "upstream_unavailable" }, 503);
  }
  return jsonResponse({ requestSecret, expiresAt: created.expiresAt });
});

// POST /api/mobile/sign-in/redeem { requestSecret, code } -> { ticket }
export const mobileSignInRedeemHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) return jsonResponse({ error: "not_configured" }, 503);
  const body = await jsonBody(request);
  const requestSecret = boundedString(body?.requestSecret, 128);
  const code = boundedString(body?.code, 128);
  if (!requestSecret || !code) return jsonResponse({ error: "invalid_request" }, 400);

  const result = await ctx.runMutation(consume, {
    requestSecretHash: await sha256Hex(requestSecret),
    codeHash: await sha256Hex(code),
  });
  if (!result.ok) return jsonResponse({ error: result.error }, result.error === "request_expired" ? 410 : 403);

  try {
    // Re-check at redemption: the account may have been locked or gained MFA
    // since the request was made.
    const account = await clerkUserEligibility(result.clerkUserId, secret);
    if (!account.allowed || account.mfaRequired) return jsonResponse({ error: "account_not_allowed" }, 403);
    return jsonResponse({ ticket: await mintSignInTicket(result.clerkUserId, secret) });
  } catch (error) {
    if (!(error instanceof ClerkBackendError)) throw error;
    return jsonResponse({ error: "upstream_unavailable" }, 503);
  }
});
