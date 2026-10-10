import { requiredEnv, shopDomain } from "./shopifyHelpers";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class InvalidShopifyIdToken extends Error {
  constructor() { super("Invalid Shopify ID token."); }
}

function decodedSegment(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 8192) throw new InvalidShopifyIdToken();
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
      (character) => character.charCodeAt(0));
  } catch { throw new InvalidShopifyIdToken(); }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InvalidShopifyIdToken();
  return value as Record<string, unknown>;
}

function jsonSegment(value: string): Record<string, unknown> {
  try { return record(JSON.parse(decoder.decode(decodedSegment(value)))); }
  catch { throw new InvalidShopifyIdToken(); }
}

function claimShop(issuer: unknown, destination: unknown): string {
  if (typeof issuer !== "string" || typeof destination !== "string") throw new InvalidShopifyIdToken();
  let iss: URL;
  let dest: URL;
  try { iss = new URL(issuer); dest = new URL(destination); }
  catch { throw new InvalidShopifyIdToken(); }
  if (iss.protocol !== "https:" || dest.protocol !== "https:" || iss.username || iss.password || dest.username || dest.password
    || iss.port || dest.port || iss.search || iss.hash || dest.search || dest.hash
    || iss.pathname !== "/admin" || (dest.pathname !== "/" && dest.pathname !== "")) throw new InvalidShopifyIdToken();
  let shop: string;
  try { shop = shopDomain(dest.hostname); }
  catch { throw new InvalidShopifyIdToken(); }
  if (iss.hostname !== shop || dest.hostname !== shop) throw new InvalidShopifyIdToken();
  return shop;
}

export async function verifyShopifyIdToken(token: string): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 12_000) throw new InvalidShopifyIdToken();
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = jsonSegment(headerPart);
  if (header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) throw new InvalidShopifyIdToken();
  const key = await crypto.subtle.importKey("raw", encoder.encode(requiredEnv("SHOPIFY_CLIENT_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = decodedSegment(signaturePart);
  if (signature.byteLength !== 32 || !await crypto.subtle.verify("HMAC", key, signature, encoder.encode(`${headerPart}.${payloadPart}`))) {
    throw new InvalidShopifyIdToken();
  }
  const claims = jsonSegment(payloadPart);
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== requiredEnv("SHOPIFY_CLIENT_ID")
    || typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= now
    || typeof claims.nbf !== "number" || !Number.isSafeInteger(claims.nbf) || claims.nbf > now
    || claims.exp <= claims.nbf || claims.exp - claims.nbf > 300) throw new InvalidShopifyIdToken();
  return claimShop(claims.iss, claims.dest);
}

export function bearerIdToken(request: Request): string {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._-]+)$/);
  if (!match) throw new InvalidShopifyIdToken();
  return match[1];
}
