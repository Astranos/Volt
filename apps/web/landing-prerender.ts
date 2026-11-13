import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

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
      return html;
    },
  };
}
