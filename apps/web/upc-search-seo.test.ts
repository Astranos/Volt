import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createServer } from "vite";

const webRoot = path.resolve(import.meta.dirname);

describe("public UPC search SEO", () => {
  it("renders shared landing content into HTML before JavaScript runs", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "volt-upc-seo-test-"));
    const server = await createServer({
      cacheDir,
      root: webRoot,
      configFile: path.join(webRoot, "vite.static.config.ts"),
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const template = await readFile(
        path.join(webRoot, "upc-search.html"),
        "utf8",
      );
      const html = await server.transformIndexHtml(
        "/upc-search.html",
        template,
      );
      expect(html).not.toContain("<!--upc-search-landing-->");
      expect(html).toContain("<h1");
      expect(html).toContain('aria-label="Volt home"');
      expect(html).toContain('src="/favicon.svg"');
      expect(html).toContain('aria-label="Primary"');
      expect(html).toContain('href="/sign-in"');
      expect(html).toContain('href="/upc-search"');
      expect(html).not.toContain("Free UPC lookup</span>");
      expect(html).toContain("What is a UPC code?");
      expect(html).toContain("No account needed.");
      expect(html).toContain('href="https://voltresale.app/upc-search"');
      expect(html).toContain('name="description"');
      expect(html).toContain('name="robots" content="index, follow"');
      expect(html).toContain('action="/upc-search"');
      expect(html).toContain('name="q"');
      expect(html).toContain('href="/sign-up"');
      expect(html).toContain('src="/src/main.tsx"');
      const home = await server.transformIndexHtml(
        "/index.html",
        await readFile(path.join(webRoot, "index.html"), "utf8"),
      );
      expect(home).not.toContain("What is a UPC code?");
      expect(home).not.toContain("<!--home-landing-->");
      expect(home).toContain("The fastest way to resell electronics.");
      expect(home).toContain('href="https://voltresale.app/"');
      expect(home).toContain('name="description"');
      const shell = await server.transformIndexHtml(
        "/app.html",
        await readFile(path.join(webRoot, "app.html"), "utf8"),
      );
      expect(shell).toContain('<div id="root"></div>');
      expect(shell).not.toContain('rel="canonical"');
    } finally {
      await server.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  }, 30_000);

  it.each(["../../vercel.json", "vercel.json"])(
    "routes static landing and noindexes query and app URLs in %s",
    async (filename) => {
      const config = JSON.parse(
        await readFile(path.resolve(webRoot, filename), "utf8"),
      );
      expect(config.buildCommand).toContain("build:static");
      expect(
        config.rewrites.find(
          (rule: { source: string }) => rule.source === "/upc-search",
        ),
      ).toEqual({ source: "/upc-search", destination: "/upc-search.html" });
      expect(config.headers).toContainEqual({
        source: "/upc-search/:path*",
        has: [{ type: "query", key: "q" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }],
      });
      for (const source of ["/robots.txt", "/sitemap.xml"]) {
        expect(config.rewrites).toContainEqual({ source, destination: source });
      }
      // App routes get the empty shell; it must not inherit the homepage.
      expect(config.rewrites.at(-1)).toEqual({
        source: "/((?!api/).*)",
        destination: "/app.html",
      });
      const noindex = config.headers.find(
        (rule: { has?: unknown; headers: { key: string }[] }) =>
          !rule.has && rule.headers[0]?.key === "X-Robots-Tag",
      );
      const pattern = new RegExp(
        `^/${noindex.source.slice("/:path(".length, -1)}$`,
      );
      for (const page of ["/dashboard", "/sign-in", "/billing", "/missing"]) {
        expect(pattern.test(page), page).toBe(true);
      }
      for (const page of [
        "/",
        "/upc-search",
        "/privacy",
        "/sitemap.xml",
        "/assets/product/mobile-02-capture-text-chip.png",
      ]) {
        expect(pattern.test(page), page).toBe(false);
      }
    },
  );

  it("lists only canonical pages in the sitemap and permits crawler access", async () => {
    const sitemap = await readFile(
      path.join(webRoot, "public/sitemap.xml"),
      "utf8",
    );
    expect(sitemap).toContain(
      "<loc>https://voltresale.app/upc-search</loc>",
    );
    expect(sitemap).not.toContain("?q=");
    const robots = await readFile(
      path.join(webRoot, "public/robots.txt"),
      "utf8",
    );
    expect(robots).toContain(
      "Sitemap: https://voltresale.app/sitemap.xml",
    );
    expect(robots).not.toContain("Disallow: /upc-search");
  });
});
