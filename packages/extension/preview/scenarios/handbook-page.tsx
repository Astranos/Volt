import "@/entrypoints/sidepanel/sidepanel.css";
import HandbookPage from "@/src/components/handbook/HandbookPage";
import { waitFor } from "../dom";
import { HandbookPreviewProvider } from "../fixtures/handbook";
import { defineScenario } from "../scenario";

const clickText = async (selector: string, text: string) => {
  await waitFor(selector);
  const target = [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.textContent?.includes(text));
  if (!target) throw new Error(`No ${selector} containing "${text}"`);
  target.click();
};

// ?open=<title> opens an article (?view=guide is the Windows guide), &edit=1 opens it in the
// editor (?view=edit), &reveal=1 reveals its login; ?new=value|secret|guide starts a new entry;
// ?state=empty shows the starter prompt.
const NEW_KIND_LABELS: Record<string, string> = { value: "Quick value", secret: "Login", guide: "Guide" };

export default defineScenario({
  description: "Full Handbook page (?open=<title>[&edit=1|&reveal=1], ?view=guide|edit, ?new=value|secret|guide, ?state=empty)",
  viewport: { width: 1280, height: 820 },
  render: (params) => (
    <HandbookPreviewProvider entries={params.get("state") === "empty" ? [] : undefined}>
      <HandbookPage />
    </HandbookPreviewProvider>
  ),
  act: async (params) => {
    if (params.get("state") === "empty") {
      await waitFor(".handbook-page-notice");
      return;
    }
    await waitFor(".handbook-list-row");
    const view = params.get("view");
    const open = params.get("open") ?? (view === "guide" || view === "edit" ? "Skip Windows sign-in" : null);
    const newKind = params.get("new");
    if (newKind) {
      await clickText(".handbook-nav-item", "New entry");
      await clickText(".handbook-segmented [role=radio]", NEW_KIND_LABELS[newKind] ?? newKind);
      await waitFor(".handbook-editor");
      return;
    }
    if (!open) return;
    await clickText(".handbook-list-open", open);
    await waitFor(".handbook-article");
    if (params.get("reveal") === "1") {
      (await waitFor<HTMLButtonElement>(".handbook-article [aria-label^='Reveal']")).click();
      await waitFor(".handbook-article [aria-label^='Hide']");
    }
    if (params.get("edit") === "1" || view === "edit") {
      await clickText(".handbook-article-head .handbook-button", "Edit");
      await waitFor(".handbook-editor");
    }
  },
});
