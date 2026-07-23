export const ACCESS_KINDS = [
  "trial",
  "complimentary",
  "subscription",
  "exhausted",
] as const;

export const SUBSCRIPTION_STATUSES = ["none", "active", "expired"] as const;

export type AccessKind = (typeof ACCESS_KINDS)[number];
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type ExtensionAccessStatus = {
  access: AccessKind;
  isAuthorized: boolean;
  freeSessionsRemaining: number;
  requiresSignIn: boolean;
  requiresSubscription: boolean;
  subscriptionStatus: SubscriptionStatus;
  productId: string;
  clerkUserId?: string;
  organizationId?: string;
  expiresAt?: number;
};

export type AccessRequestFailure = {
  success: false;
  error: string;
  statusCode?: number;
  accessStatus?: ExtensionAccessStatus;
};

export type AccessRequestSuccess<T> = {
  success: true;
  value: T;
  accessStatus?: ExtensionAccessStatus;
};

export type AccessRequestResult<T> =
  | AccessRequestSuccess<T>
  | AccessRequestFailure;

function objectFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function isOneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseExtensionAccessStatus(
  value: unknown,
): ExtensionAccessStatus | null {
  const record = objectFrom(value);
  if (!record || !isOneOf(record.access, ACCESS_KINDS)) return null;

  const freeSessionsRemaining =
    typeof record.freeSessionsRemaining === "number" &&
    Number.isFinite(record.freeSessionsRemaining)
      ? Math.max(0, Math.floor(record.freeSessionsRemaining))
      : 0;

  return {
    access: record.access,
    isAuthorized: record.isAuthorized === true,
    freeSessionsRemaining,
    requiresSignIn: record.requiresSignIn === true,
    requiresSubscription: record.requiresSubscription === true,
    subscriptionStatus: isOneOf(
      record.subscriptionStatus,
      SUBSCRIPTION_STATUSES,
    )
      ? record.subscriptionStatus
      : "none",
    productId:
      typeof record.productId === "string" ? record.productId : "",
    clerkUserId: optionalString(record.clerkUserId),
    organizationId: optionalString(record.organizationId),
    expiresAt: optionalTimestamp(record.expiresAt),
  };
}

export function accessStatusFromPayload(
  payload: unknown,
): ExtensionAccessStatus | null {
  const direct = parseExtensionAccessStatus(payload);
  if (direct) return direct;
  const record = objectFrom(payload);
  return parseExtensionAccessStatus(
    record?.accessStatus ?? record?.status ?? record?.access,
  );
}

export function errorMessageFromPayload(
  payload: unknown,
  fallback: string,
) {
  const record = objectFrom(payload);
  const error = record?.error;
  return typeof error === "string" && error.length > 0 ? error : fallback;
}
