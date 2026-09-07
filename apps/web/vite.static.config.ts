import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { upcSearchPrerender } from "./upc-search-prerender";

export default defineConfig({
  plugins: [tailwindcss(), react(), upcSearchPrerender()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
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
