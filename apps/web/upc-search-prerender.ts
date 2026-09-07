import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  UPC_SEARCH_CANONICAL,
  UPC_SEARCH_DESCRIPTION,
  UPC_SEARCH_TITLE,
} from "./src/lib/upc-search";

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Render the same introductory content crawlers and the interactive page see. */
export function upcSearchPrerender(): Plugin {
  return {
    name: "upc-search-prerender",
    async transformIndexHtml(html, context) {
      if (!context.filename.endsWith("/upc-search.html")) return html;
      // Never invalidate the running client's optimized dependencies.
      const cacheDir = await mkdtemp(
        path.join(tmpdir(), "volt-upc-prerender-"),
      );
      const server = await createServer({
        configFile: false,
        cacheDir,
        root: path.dirname(context.filename),
        plugins: [react()],
        server: { middlewareMode: true, hmr: false },
        appType: "custom",
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      try {
        const content = await server.ssrLoadModule(
          "/src/components/upc-search/public-upc-search.tsx",
        );
        const chrome = await server.ssrLoadModule("/src/site-chrome.tsx");
        const markup = renderToStaticMarkup(
          createElement(
            Fragment,
            null,
            createElement(chrome.SiteHeaderFrame),
            createElement(
              "main",
              { className: "bg-zinc-50 px-5 pb-20 pt-14 sm:px-8 sm:pt-20" },
              createElement(content.UpcSearchIntro),
              createElement(
                "form",
                {
                  action: "/upc-search",
                  method: "get",
                  className: "mx-auto mt-9 flex max-w-3xl flex-col gap-3",
                },
                createElement(
                  "label",
                  {
                    htmlFor: "static-upc-query",
                    className: "text-sm font-medium text-zinc-700",
                  },
                  "Product name, UPC, or MPN",
                ),
                createElement("input", {
                  id: "static-upc-query",
                  name: "q",
                  type: "search",
                  maxLength: 120,
                  className: "rounded-xl border border-zinc-200 bg-white p-4",
                }),
                createElement(
                  "button",
                  {
                    type: "submit",
                    className:
                      "rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white",
                  },
                  "Search UPCs",
                ),
              ),
              createElement(
                "noscript",
                null,
                "Enable JavaScript to search Volt's product catalog.",
              ),
              createElement(content.UpcSearchGuide),
            ),
          ),
        );
        return html
          .replace("__UPC_SEARCH_TITLE__", escapeAttribute(UPC_SEARCH_TITLE))
          .replace(
            "__UPC_SEARCH_DESCRIPTION__",
            escapeAttribute(UPC_SEARCH_DESCRIPTION),
          )
          .replace(
            "__UPC_SEARCH_CANONICAL__",
            escapeAttribute(UPC_SEARCH_CANONICAL),
          )
          .replace("<!--upc-search-landing-->", markup);
      } finally {
        await server.close();
        await rm(cacheDir, { recursive: true, force: true });
      }
    },
  };
}
