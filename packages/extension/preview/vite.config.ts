import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Rooted at the extension package (like WXT) so Tailwind scans the same
// sources and public/ assets resolve; the preview page lives at /preview/.
const extension = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspace = path.resolve(extension, "../..");

export default defineConfig({
  root: extension,
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": extension, "~": extension } },
  // `pnpm shots --before` renders an old checkout whose node_modules links to this one's.
  server: { open: "/preview/", fs: { allow: [workspace, path.dirname(realpathSync(path.join(workspace, "node_modules")))] } },
  cacheDir: path.join(tmpdir(), "volt-preview-vite", Buffer.from(extension).toString("base64url")),
  optimizeDeps: { entries: ["preview/index.html", "preview/scenarios/*.tsx"] },
  logLevel: "warn",
});
