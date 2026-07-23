"use node";

import {
  Environment,
  SignedDataVerifier,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import {
  action,
  internalAction,
  type ActionCtx,
} from "./_generated/server";
import {
  clerkAuthContextFromIdentity,
  storeKitProductId,
  type AccessStatus,
  type ClerkAuthContext,
} from "./access";

type AccessResult = { statusCode: number; body: AccessStatus | { error: string } };
type TransactionResult = { statusCode: number; body: Record<string, unknown> };
type VerifiedTransaction = {
  transactionId: string;
  originalTransactionId: string;
  appAccountToken: string;
  productId: string;
  environment: string;
  purchaseDate: number;
  expiresDate: number;
  revocationDate?: number;
  signedDate: number;
};
type NotificationMetadata = {
  notificationUUID: string;
  notificationType: string;
  subtype?: string;
  signedDate?: number;
};

const getStatusForHttp = makeFunctionReference<
  "mutation",
  ClerkAuthContext & { anonymousId?: string; anonymousSecret?: string },
  AccessResult
>("access:getStatusForHttp");
const applyVerifiedTransaction = makeFunctionReference<
  "mutation",
  VerifiedTransaction & {
    source: "client" | "notification";
    expectedClerkUserId?: string;
    notification?: NotificationMetadata;
  },
  TransactionResult
>("storeKitData:applyVerifiedTransaction");
const recordVerifiedNotification = makeFunctionReference<
  "mutation",
  NotificationMetadata,
  TransactionResult
>("storeKitData:recordVerifiedNotification");

const authArgs = {
  clerkUserId: v.optional(v.string()),
  tokenIdentifier: v.optional(v.string()),
  organizationId: v.optional(v.string()),
  organizationName: v.optional(v.string()),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
};

function certificateStrings() {
  const raw = process.env.APPLE_ROOT_CA_CERTIFICATES_BASE64;
  if (!raw) throw new Error("APPLE_ROOT_CA_CERTIFICATES_BASE64 is not configured");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  } catch (_error) {
    // A comma-separated list is also supported for secret managers without JSON editing.
  }
  return raw.split(",").map((certificate) => certificate.trim()).filter(Boolean);
}

function certificateBuffer(value: string) {
  const base64 = value
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s/g, "");
  return Buffer.from(base64, "base64");
}

function verifierFor(environment: Environment) {
  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!bundleId) throw new Error("APPLE_BUNDLE_ID is not configured");
  const appAppleId = Number.parseInt(process.env.APPLE_APP_ID ?? "", 10);
  if (environment === Environment.PRODUCTION && !Number.isFinite(appAppleId)) {
    throw new Error("APPLE_APP_ID is required for production StoreKit verification");
  }
  return new SignedDataVerifier(
    certificateStrings().map(certificateBuffer),
    process.env.APPLE_ENABLE_ONLINE_CHECKS !== "false",
    environment,
    bundleId,
    environment === Environment.PRODUCTION ? appAppleId : undefined,
  );
}

async function verifyWithEnvironment<T>(
  operation: (verifier: SignedDataVerifier) => Promise<T>,
) {
  const errors: string[] = [];
  for (const environment of [Environment.PRODUCTION, Environment.SANDBOX]) {
    try {
      const verifier = verifierFor(environment);
      return { decoded: await operation(verifier), verifier, environment };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "verification failed");
    }
  }
  throw new Error(`Apple signed data verification failed: ${errors.join("; ")}`);
}

function normalizedTransaction(
  payload: JWSTransactionDecodedPayload,
  fallbackEnvironment: Environment,
): VerifiedTransaction {
  if (
    !payload.transactionId ||
    !payload.originalTransactionId ||
    !payload.appAccountToken ||
    !payload.productId ||
    payload.purchaseDate === undefined ||
    payload.expiresDate === undefined ||
    payload.signedDate === undefined
  ) {
    throw new Error("StoreKit transaction is missing required subscription fields");
  }
  if (payload.productId !== storeKitProductId()) {
    throw new Error("StoreKit transaction has an unexpected product id");
  }
  return {
    transactionId: payload.transactionId,
    originalTransactionId: payload.originalTransactionId,
    appAccountToken: payload.appAccountToken.toLowerCase(),
    productId: payload.productId,
    environment: String(payload.environment ?? fallbackEnvironment),
    purchaseDate: payload.purchaseDate,
    expiresDate: payload.expiresDate,
    signedDate: payload.signedDate,
    ...(payload.revocationDate !== undefined ? { revocationDate: payload.revocationDate } : {}),
  };
}

async function verifyTransaction(signedTransaction: string) {
  const verified = await verifyWithEnvironment((verifier) =>
    verifier.verifyAndDecodeTransaction(signedTransaction),
  );
  return normalizedTransaction(verified.decoded, verified.environment);
}

async function accessForAuth(ctx: ActionCtx, auth: ClerkAuthContext) {
  if (!auth.clerkUserId || !auth.tokenIdentifier) {
    return { statusCode: 401, body: { error: "Clerk authentication required" } } as const;
  }
  return ctx.runMutation(getStatusForHttp, auth);
}

async function syncTransaction(
  ctx: ActionCtx,
  auth: ClerkAuthContext,
  signedTransaction: string,
) {
  const access = await accessForAuth(ctx, auth);
  if (access.statusCode !== 200 || !("appAccountToken" in access.body) || !access.body.appAccountToken) {
    return { statusCode: access.statusCode, body: access.body };
  }
  try {
    const transaction = await verifyTransaction(signedTransaction);
    if (transaction.appAccountToken !== access.body.appAccountToken.toLowerCase()) {
      return { statusCode: 403, body: { error: "Transaction belongs to another account" } };
    }
    return ctx.runMutation(applyVerifiedTransaction, {
      ...transaction,
      source: "client",
      expectedClerkUserId: auth.clerkUserId,
    });
  } catch (error) {
    console.warn("[Volt StoreKit] client transaction rejected", {
      reason: error instanceof Error ? error.message : "verification failed",
    });
    return { statusCode: 400, body: { error: "Invalid signed StoreKit transaction" } };
  }
}

export const sync = action({
  args: { signedTransaction: v.string() },
  handler: async (ctx, args) =>
    syncTransaction(
      ctx,
      clerkAuthContextFromIdentity(await ctx.auth.getUserIdentity()),
      args.signedTransaction,
    ),
});

export const syncForHttp = internalAction({
  args: { ...authArgs, signedTransaction: v.string() },
  handler: (ctx, args) => syncTransaction(ctx, args, args.signedTransaction),
});

async function verifiedNotification(signedPayload: string) {
  const verified = await verifyWithEnvironment((verifier) =>
    verifier.verifyAndDecodeNotification(signedPayload),
  );
  return verified as {
    decoded: ResponseBodyV2DecodedPayload;
    verifier: SignedDataVerifier;
    environment: Environment;
  };
}

export const acceptNotification = internalAction({
  args: { signedPayload: v.string() },
  handler: async (ctx, args) => {
    try {
      const { decoded, verifier, environment } = await verifiedNotification(args.signedPayload);
      if (!decoded.notificationUUID || !decoded.notificationType) {
        return { statusCode: 400, body: { error: "Notification is missing required fields" } };
      }
      const notification = {
        notificationUUID: decoded.notificationUUID,
        notificationType: String(decoded.notificationType),
        ...(decoded.subtype ? { subtype: String(decoded.subtype) } : {}),
        ...(decoded.signedDate !== undefined ? { signedDate: decoded.signedDate } : {}),
      };
      if (!decoded.data?.signedTransactionInfo) {
        return ctx.runMutation(recordVerifiedNotification, notification);
      }
      const payload = await verifier.verifyAndDecodeTransaction(decoded.data.signedTransactionInfo);
      const transaction = normalizedTransaction(payload, environment);
      return ctx.runMutation(applyVerifiedTransaction, {
        ...transaction,
        source: "notification",
        notification,
      });
    } catch (error) {
      console.warn("[Volt StoreKit] server notification rejected", {
        reason: error instanceof Error ? error.message : "verification failed",
      });
      return { statusCode: 400, body: { error: "Invalid App Store Server Notification" } };
    }
  },
});
