/** Tailwind v4 uses the config-less flow, but we keep a minimal config
 * to safelist dynamic classes if needed and to ensure proper content globs. */
module.exports = {
  content: ["./entrypoints/**/*.{html,ts,tsx,css}", "./src/**/*.{ts,tsx,css}"],
  plugins: [require("tailwindcss-animate")],
  safelist: [
    // shadcn tokens often used dynamically
    "bg-background",
    "text-foreground",
    "border-border",
    "text-muted-foreground",
  ],
};
