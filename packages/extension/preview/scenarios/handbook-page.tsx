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

// ?view=guide opens the Windows guide article; ?view=edit opens it in the editor; ?state=empty shows the starter prompt.
export default defineScenario({
  description: "Full Handbook page (?view=guide|edit, ?state=empty)",
  viewport: { width: 1280, height: 820 },
  render: (params) => (
    <HandbookPreviewProvider entries={params.get("state") === "empty" ? [] : undefined}>
      <HandbookPage />
    </HandbookPreviewProvider>
  ),
  act: async (params) => {
    const view = params.get("view");
    if (params.get("state") === "empty") {
      await waitFor(".handbook-page-notice");
      return;
    }
    await waitFor(".handbook-list-row");
    if (view === "guide" || view === "edit") {
      await clickText(".handbook-list-open", "Skip Windows sign-in");
      await waitFor(".handbook-article");
    }
    if (view === "edit") {
      await clickText(".handbook-article-head .handbook-button", "Edit");
      await waitFor(".handbook-editor");
    }
  },
});
