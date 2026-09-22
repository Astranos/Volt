import { type Infer } from "convex/values";
import { catalogSummaryValidator, storedCatalogProductValidator } from "../catalog/validators";
import { makeFunctionReference } from "convex/server";
import { jsonResponse, emptyResponse } from "./shared";
import { type ActionCtx, httpAction } from "../_generated/server";
import { hasProductApiKeyFormat, sha256Hex } from "../productApiKeyCrypto";

type ProductSummary = Infer<typeof catalogSummaryValidator>;

type StoredCatalogProduct = Infer<typeof storedCatalogProductValidator>;

type ProductSearchResult = {
  page: ProductSummary[];
  isDone: boolean;
  continueCursor: string;
};

type ProductApiAuthorizationResult =
  | {
      kind: "authorized";
      limit: number;
      remaining: number;
      resetAt: number;
    }
  | { kind: "invalid_key" }
  | {
      kind: "rate_limited";
      limit: number;
      remaining: number;
      resetAt: number;
      retryAfterSeconds: number;
    };

const authenticateProductApiKey = makeFunctionReference<
  "mutation",
  { keyHash: string; now: number },
  ProductApiAuthorizationResult
>("productApiKeys:authenticateAndConsume");

const searchProductsForApi = makeFunctionReference<
  "query",
  {
    searchQuery?: string;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  ProductSearchResult
>("productData:searchProductsForApi");

const getProductByUpcForApi = makeFunctionReference<
  "query",
  { upc: string },
  StoredCatalogProduct | null
>("productData:getProductByUpcForApi");

function productApiError(
  code: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
) {
  return jsonResponse({ error: { code, message } }, status, headers);
}

function productApiRateLimitHeaders(result: {
  limit: number;
  remaining: number;
  resetAt: number;
}): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

type ProductApiRequestAuthorization =
  | { kind: "authorized"; headers: Record<string, string> }
  | { kind: "rejected"; response: Response };

async function authorizeProductApiRequest(
  ctx: ActionCtx,
  request: Request,
): Promise<ProductApiRequestAuthorization> {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  const token = match?.[1];
  if (!token) {
    return {
      kind: "rejected",
      response: productApiError(
        "missing_authorization",
        "Use an Authorization header with a Bearer API key",
        401,
      ),
    };
  }
  if (!hasProductApiKeyFormat(token)) {
    return {
      kind: "rejected",
      response: productApiError("invalid_api_key", "The API key is invalid or revoked", 401),
    };
  }

  const result = await ctx.runMutation(authenticateProductApiKey, {
    keyHash: await sha256Hex(token),
    now: Date.now(),
  });
  switch (result.kind) {
    case "authorized":
      return { kind: "authorized", headers: productApiRateLimitHeaders(result) };
    case "invalid_key":
      return {
        kind: "rejected",
        response: productApiError("invalid_api_key", "The API key is invalid or revoked", 401),
      };
    case "rate_limited": {
      const headers = {
        ...productApiRateLimitHeaders(result),
        "Retry-After": String(result.retryAfterSeconds),
      };
      return {
        kind: "rejected",
        response: productApiError(
          "rate_limit_exceeded",
          "This API key has reached its 120 requests per minute limit",
          429,
          headers,
        ),
      };
    }
    default: {
      const exhaustive: never = result;
      throw new Error(`Unhandled product API authorization result: ${exhaustive}`);
    }
  }
}

function productApiLimitFrom(url: URL): number | null {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 25;
  if (!/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  return limit >= 1 && limit <= 100 ? limit : null;
}

export const productApiCollectionHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const authorization = await authorizeProductApiRequest(ctx, request);
  if (authorization.kind === "rejected") return authorization.response;

  const url = new URL(request.url);
  const limit = productApiLimitFrom(url);
  const searchQuery = url.searchParams.get("q");
  const cursorParameter = url.searchParams.get("cursor");
  if (
    limit === null
    || (searchQuery !== null && searchQuery.length > 200)
    || cursorParameter === ""
    || (cursorParameter !== null && cursorParameter.length > 1_024)
  ) {
    return productApiError(
      "invalid_request",
      "limit must be an integer from 1 to 100, q must be at most 200 characters, and cursor must be 1 to 1024 characters",
      400,
      authorization.headers,
    );
  }

  let result: ProductSearchResult;
  try {
    result = await ctx.runQuery(searchProductsForApi, {
      ...(searchQuery !== null ? { searchQuery } : {}),
      paginationOpts: { numItems: limit, cursor: cursorParameter },
    });
  } catch (error) {
    if (cursorParameter === null) throw error;
    return productApiError(
      "invalid_cursor",
      "The pagination cursor is invalid or expired",
      400,
      authorization.headers,
    );
  }
  return jsonResponse({
    data: result.page,
    pagination: {
      nextCursor: result.isDone ? null : result.continueCursor,
    },
  }, 200, authorization.headers);
});

export const productApiItemHandler = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") return emptyResponse();
  const authorization = await authorizeProductApiRequest(ctx, request);
  if (authorization.kind === "rejected") return authorization.response;

  const encodedUpc = new URL(request.url).pathname.slice("/v1/products/".length);
  let upc: string;
  try {
    upc = decodeURIComponent(encodedUpc);
  } catch {
    return productApiError("invalid_request", "The UPC path segment is invalid", 400, authorization.headers);
  }
  if (!upc || upc.includes("/") || upc.length > 32) {
    return productApiError("invalid_request", "Provide one UPC path segment", 400, authorization.headers);
  }

  const product = await ctx.runQuery(getProductByUpcForApi, { upc });
  if (!product) {
    return productApiError("product_not_found", "No product was found for this UPC", 404, authorization.headers);
  }
  return jsonResponse({ data: product }, 200, authorization.headers);
});
