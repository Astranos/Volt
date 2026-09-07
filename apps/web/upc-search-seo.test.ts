import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "vite";

const webRoot = path.resolve(import.meta.dirname);

describe("public UPC search SEO", () => {
  it("renders shared landing content into HTML before JavaScript runs", async () => {
    const server = await createServer({
      root: webRoot,
      configFile: path.join(webRoot, "vite.static.config.ts"),
      server: { middlewareMode: true },
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
      expect(html).toContain("What is a UPC code?");
      expect(html).toContain("No account needed.");
      expect(html).toContain('href="https://volt.juanquenga.com/upc-search"');
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
    } finally {
      await server.close();
    }
  }, 30_000);

  it.each(["../../vercel.json", "vercel.json"])(
    "routes static landing and noindexes query URLs in %s",
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
    },
  );

  it("lists only canonical pages in the sitemap and permits crawler access", async () => {
    const sitemap = await readFile(
      path.join(webRoot, "public/sitemap.xml"),
      "utf8",
    );
    expect(sitemap).toContain(
      "<loc>https://volt.juanquenga.com/upc-search</loc>",
    );
    expect(sitemap).not.toContain("?q=");
    const robots = await readFile(
      path.join(webRoot, "public/robots.txt"),
      "utf8",
    );
    expect(robots).toContain(
      "Sitemap: https://volt.juanquenga.com/sitemap.xml",
    );
    expect(robots).not.toContain("Disallow: /upc-search");
  });
});
