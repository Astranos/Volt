import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type Plugin, type ViteDevServer } from "vite";
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

type ModuleLoader = (
  url: string,
) => ReturnType<ViteDevServer["ssrLoadModule"]>;

/** SSR-load source modules in a throwaway Vite server and render markup. */
async function prerender(
  root: string,
  render: (load: ModuleLoader) => Promise<string>,
) {
  // Never invalidate the running client's optimized dependencies.
  const cacheDir = await mkdtemp(path.join(tmpdir(), "volt-prerender-"));
  const server = await createServer({
    configFile: false,
    cacheDir,
    root,
    plugins: [react()],
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await render((url) => server.ssrLoadModule(url));
  } finally {
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
}

/**
 * Render the same content crawlers and the interactive page see for the
 * public landing pages. App routes use the empty `app.html` shell instead.
 */
export function landingPrerender(): Plugin {
  return {
    name: "landing-prerender",
    async transformIndexHtml(html, context) {
      const root = path.dirname(context.filename);
      if (context.filename.endsWith("/index.html")) {
        const markup = await prerender(root, async (load) => {
          const home = await load("/src/routes/index.tsx");
          const chrome = await load("/src/site-chrome.tsx");
          return renderToStaticMarkup(
            createElement(home.HomePage, {
              header: createElement(chrome.SiteHeaderFrame, {
                anchorPrefix: "",
              }),
            }),
          );
        });
        return html.replace("<!--home-landing-->", markup);
      }
      if (!context.filename.endsWith("/upc-search.html")) return html;
      const markup = await prerender(root, async (load) => {
        const content = await load(
          "/src/components/upc-search/public-upc-search.tsx",
        );
        const chrome = await load("/src/site-chrome.tsx");
        return renderToStaticMarkup(
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
      });
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
    },
  };
}
