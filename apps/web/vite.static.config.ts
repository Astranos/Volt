import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { landingPrerender } from "./landing-prerender";

export default defineConfig({
  plugins: [tailwindcss(), react(), landingPrerender()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        app: path.resolve(__dirname, "app.html"),
        shopify: path.resolve(__dirname, "shopify.html"),
        upcSearch: path.resolve(__dirname, "upc-search.html"),
      },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
});
