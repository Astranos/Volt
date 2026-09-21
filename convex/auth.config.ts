import type { AuthConfig } from "convex/server";

const primaryIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim();
if (!primaryIssuer) throw new Error("CLERK_JWT_ISSUER_DOMAIN is required.");

// Dev builds can use the existing Volt account without dropping development accounts.
// Additional trust is opt-in per deployment; production keeps its single issuer.
const configuredIssuers = [primaryIssuer, process.env.CLERK_ADDITIONAL_JWT_ISSUER_DOMAIN?.trim()]
  .filter((issuer): issuer is string => Boolean(issuer));
const domains = [...new Set(configuredIssuers.map((issuer) => {
  const url = new URL(issuer);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Clerk JWT issuer must be an HTTPS origin.");
  }
  return url.origin;
}))];

export default {
  providers: domains.map((domain) => ({ domain, applicationID: "convex" })),
} satisfies AuthConfig;
