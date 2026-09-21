import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

test("an explicitly configured additional Clerk issuer works without removing development sign-ins", async () => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://large-serval-91.clerk.accounts.dev");
  vi.stubEnv("CLERK_ADDITIONAL_JWT_ISSUER_DOMAIN", "https://clerk.volt.juanquenga.com");
  const { default: config } = await import("./auth.config");
  expect(config.providers).toEqual([
    { domain: "https://large-serval-91.clerk.accounts.dev", applicationID: "convex" },
    { domain: "https://clerk.volt.juanquenga.com", applicationID: "convex" },
  ]);
});

test("deployments without an additional issuer keep their existing trust boundary", async () => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.volt.juanquenga.com");
  vi.stubEnv("CLERK_ADDITIONAL_JWT_ISSUER_DOMAIN", "");
  const { default: config } = await import("./auth.config");
  expect(config.providers).toEqual([{ domain: "https://clerk.volt.juanquenga.com", applicationID: "convex" }]);
});

test("identical issuers are deduplicated after URL normalization", async () => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.volt.juanquenga.com");
  vi.stubEnv("CLERK_ADDITIONAL_JWT_ISSUER_DOMAIN", "https://clerk.volt.juanquenga.com/");
  const { default: config } = await import("./auth.config");
  expect(config.providers).toHaveLength(1);
});

test.each(["http://clerk.example.com", "https://user:pass@clerk.example.com", "https://clerk.example.com/path"])("rejects an invalid configured issuer: %s", async (issuer) => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  await expect(import("./auth.config")).rejects.toThrow(/HTTPS origin/);
});
