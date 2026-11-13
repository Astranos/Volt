// Minimal Clerk Backend API client for HTTP actions. Never log credentials.

export class ClerkBackendError extends Error {
  constructor(readonly status: number) { super(`clerk_backend_${status}`); }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }

// Bound bodies before parsing, including upstream responses.
export async function readBoundedJson(body: ReadableStream<Uint8Array> | null, limit: number): Promise<unknown> {
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

async function clerkRequest(path: string, secret: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.clerk.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secret}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new ClerkBackendError(response.status);
    return await readBoundedJson(response.body, 128 * 1024);
  } catch (error) {
    if (error instanceof ClerkBackendError) throw error;
    throw new ClerkBackendError(503);
  } finally { clearTimeout(timeout); }
}

export type SignInEligibility = { userId: string; allowed: boolean; mfaRequired: boolean };

function eligibility(user: Record<string, unknown>): SignInEligibility {
  const userId = text(user.id);
  if (!/^user_[A-Za-z0-9]+$/.test(userId) || typeof user.banned !== "boolean" || typeof user.locked !== "boolean" || typeof user.two_factor_enabled !== "boolean") {
    throw new ClerkBackendError(503);
  }
  return { userId, allowed: !user.banned && !user.locked, mfaRequired: user.two_factor_enabled };
}

/** The one account whose verified email matches, or null. */
export async function findClerkUserByVerifiedEmail(email: string, secret: string): Promise<SignInEligibility | null> {
  const query = new URLSearchParams({ email_address: email, limit: "2" });
  // BAPI returns a raw array; the SDK's paginated wrapper is not the wire format.
  const users = await clerkRequest(`/users?${query}`, secret);
  if (!Array.isArray(users)) throw new ClerkBackendError(503);
  if (users.length !== 1) return null;
  const user = object(users[0]);
  const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
  const verified = emails.some((value) => {
    const entry = object(value);
    return text(entry.email_address).toLowerCase() === email && object(entry.verification).status === "verified";
  });
  return verified ? eligibility(user) : null;
}

export async function clerkUserEligibility(userId: string, secret: string): Promise<SignInEligibility> {
  const result = eligibility(object(await clerkRequest(`/users/${encodeURIComponent(userId)}`, secret)));
  if (result.userId !== userId) throw new ClerkBackendError(503);
  return result;
}

/** Mints a one-use Clerk sign-in ticket. Tickets skip MFA, so callers must refuse MFA accounts. */
export async function mintSignInTicket(userId: string, secret: string, expiresInSeconds = 60): Promise<string> {
  const signInToken = object(await clerkRequest("/sign_in_tokens", secret, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: expiresInSeconds }),
  }));
  const ticket = text(signInToken.token);
  if (!ticket || ticket.length > 8192 || signInToken.user_id !== userId || signInToken.status !== "pending") {
    throw new ClerkBackendError(503);
  }
  return ticket;
}
