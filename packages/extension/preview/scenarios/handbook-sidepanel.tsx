import "@/entrypoints/sidepanel/sidepanel.css";
import UnifiedSidepanel from "@/src/components/sidepanel/UnifiedSidepanel";
import { HANDBOOK_OPEN_ENTRY_KEY } from "@/src/domain/handbook";
import { waitFor } from "../dom";
import { handbookEntryByTitle, handbookGuide, HandbookPreviewProvider } from "../fixtures/handbook";
import { defineScenario } from "../scenario";

// ?view=guide opens the Windows guide with its first step done; ?open=<title> opens any entry;
// ?chip=<label> filters to a category; ?reveal=1 reveals the first login; ?state=empty shows the starter prompt.
const params = new URLSearchParams(location.search);
const openId = params.get("view") === "guide" ? handbookGuide._id : handbookEntryByTitle(params.get("open") ?? "")?._id;
export default defineScenario({
  description: "Sidepanel Handbook tab (?view=guide for step-by-step mode, ?open=<title>, ?reveal=1, ?state=empty)",
  viewport: { width: 400, height: 820 },
  chrome: {
    storage: {
      local: {
        sidePanelTool: "handbook",
        // Requested "now" so the panel's freshness check accepts it.
        ...(openId ? { [HANDBOOK_OPEN_ENTRY_KEY]: { id: openId, requestedAt: Date.now() } } : {}),
      },
    },
  },
  render: (params) => (
    <div id="volt-sidepanel-container" style={{ height: "100vh" }}>
      <HandbookPreviewProvider entries={params.get("state") === "empty" ? [] : undefined}>
        <UnifiedSidepanel />
      </HandbookPreviewProvider>
    </div>
  ),
  act: async (params) => {
    if (params.get("view") === "guide") {
      (await waitFor<HTMLButtonElement>(".handbook-step-number.is-current")).click();
      await waitFor(".handbook-step-number.is-done");
    } else {
      await waitFor(params.get("state") === "empty" ? ".sidepanel-empty-history"
        : params.get("open") ? ".handbook-guide-title" : ".handbook-row");
      // ?chip=<label> picks a category chip, e.g. chip=Policies.
      const chip = params.get("chip");
      if (chip) [...document.querySelectorAll<HTMLButtonElement>(".handbook-chip")].find((button) => button.textContent === chip)?.click();
      if (params.get("reveal") === "1") {
        (await waitFor<HTMLButtonElement>("[aria-label^='Reveal']")).click();
        await waitFor("[aria-label^='Hide']");
      }
    }
  },
});
