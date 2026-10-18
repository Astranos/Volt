import { createRoot } from "react-dom/client";
import { installChromeStub, setChromeFixture } from "./chrome-stub";
import type { Scenario } from "./scenario";

installChromeStub();

// Every file in scenarios/ is a scenario, named after the file.
const modules = import.meta.glob<{ default: Scenario }>("./scenarios/*.tsx");
const scenarios = Object.fromEntries(
  Object.entries(modules).map(([path, load]) => [path.replace(/^\.\/scenarios\/|\.tsx$/g, ""), load]),
);

declare global {
  interface Window {
    __voltPreview?: { scenarios: Record<string, string> } | Pick<Scenario, "viewport" | "fullPage">;
  }
}

// The favicon service only exists inside the extension; borrow Google's instead.
document.addEventListener("error", (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.src.startsWith("chrome-extension://")) return;
  const favicon = new URL(img.src);
  const page = favicon.searchParams.get("pageUrl");
  if (page) img.src = `https://www.google.com/s2/favicons?domain=${new URL(page).hostname}&sz=${favicon.searchParams.get("size") ?? 32}`;
}, true);

async function main() {
  const params = new URLSearchParams(location.search);
  const name = params.get("scenario");
  const root = createRoot(document.getElementById("root")!);

  if (!name) {
    const descriptions = Object.fromEntries(await Promise.all(
      Object.entries(scenarios).map(async ([key, load]) => [key, (await load()).default.description] as const),
    ));
    window.__voltPreview = { scenarios: descriptions };
    root.render(
      <ul style={{ font: "14px/1.8 system-ui", padding: 24 }}>
        {Object.entries(descriptions).map(([key, description]) => (
          <li key={key}><a href={`?scenario=${key}`}>{key}</a> — {description}</li>
        ))}
      </ul>,
    );
    return;
  }

  const load = scenarios[name];
  if (!load) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(scenarios).join(", ")}`);
  const scenario = (await load()).default;
  setChromeFixture(scenario.chrome);
  root.render(scenario.render(params));
  await scenario.act?.(params);
  window.__voltPreview = { viewport: scenario.viewport, fullPage: scenario.fullPage };
  requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.previewReady = "true"; }));
}

main().catch((error: unknown) => {
  document.documentElement.dataset.previewError = error instanceof Error ? error.message : String(error);
  throw error;
});
