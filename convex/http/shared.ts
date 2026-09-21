import { type ClerkAuthContext, clerkAuthContextFromIdentity } from "../access";
import { type ActionCtx } from "../_generated/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Volt-Anonymous-Id, X-Volt-Anonymous-Secret, X-Volt-Browser-Claim, X-Volt-Pairing-Secret, X-Volt-Device-Id, X-Volt-Device-Secret",
  "Access-Control-Expose-Headers":
    "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After",
  "Cache-Control": "no-store",
};

export function jsonResponse(body: unknown, status = 200, additionalHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...additionalHeaders, "Content-Type": "application/json" },
  });
}

export function emptyResponse(status = 204) {
  return new Response(null, { status, headers: corsHeaders });
}

export function objectFrom(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function stringField(value: unknown, key: string) {
  const field = objectFrom(value)[key];
  return typeof field === "string" ? field : undefined;
}

export type AccessHttpArgs = ClerkAuthContext & {
  anonymousId?: string;
  anonymousSecret?: string;
};

function anonymousCredentialsFromRequest(request: Request): Pick<AccessHttpArgs, "anonymousId" | "anonymousSecret"> {
  const anonymousId = request.headers.get("X-Volt-Anonymous-Id") ?? undefined;
  const anonymousSecret = request.headers.get("X-Volt-Anonymous-Secret") ?? undefined;
  return {
    ...(anonymousId ? { anonymousId } : {}),
    ...(anonymousSecret ? { anonymousSecret } : {}),
  };
}

export async function accessArgsFromRequest(
  ctx: Pick<ActionCtx, "auth">,
  request: Request,
): Promise<{ ok: true; args: AccessHttpArgs } | { ok: false }> {
  const anonymousCredentials = anonymousCredentialsFromRequest(request);
  if (!request.headers.get("Authorization")) {
    return { ok: true, args: anonymousCredentials };
  }
  try {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false };
    return {
      ok: true,
      args: { ...clerkAuthContextFromIdentity(identity), ...anonymousCredentials },
    };
  } catch (_error) {
    return { ok: false };
  }
}
