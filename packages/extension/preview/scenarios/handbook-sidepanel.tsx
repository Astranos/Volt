import "@/entrypoints/sidepanel/sidepanel.css";
import UnifiedSidepanel from "@/src/components/sidepanel/UnifiedSidepanel";
import { HANDBOOK_OPEN_ENTRY_KEY } from "@/src/domain/handbook";
import { waitFor } from "../dom";
import { handbookEntryByTitle, handbookGuide, HandbookPreviewProvider } from "../fixtures/handbook";
import { defineScenario } from "../scenario";

// ?view=guide opens the Windows guide with its first step done; ?open=<title> opens any entry;
// ?reveal=1 reveals the first login; ?state=empty shows the starter prompt;
// ?tool=top-offers|mobile-scanner opens another tab to compare margins; ?width=<px> narrows the panel.
const params = new URLSearchParams(location.search);
const tool = params.get("tool");
const openId = params.get("view") === "guide" ? handbookGuide._id : handbookEntryByTitle(params.get("open") ?? "")?._id;
export default defineScenario({
  description: "Sidepanel Handbook tab (?view=guide for step-by-step mode, ?open=<title>, ?reveal=1, ?state=empty, ?tool=<other tab>)",
  viewport: { width: 400, height: 820 },
  chrome: {
    storage: {
      local: {
        sidePanelTool: tool ?? "handbook",
        // Requested "now" so the panel's freshness check accepts it.
        ...(openId ? { [HANDBOOK_OPEN_ENTRY_KEY]: { id: openId, requestedAt: Date.now() } } : {}),
      },
    },
  },
  render: (params) => (
    <div id="volt-sidepanel-container" style={{ height: "100vh", width: params.get("width") ? `${Number(params.get("width"))}px` : undefined }}>
      <HandbookPreviewProvider entries={params.get("state") === "empty" ? [] : undefined}>
        <UnifiedSidepanel />
      </HandbookPreviewProvider>
    </div>
  ),
  act: async (params) => {
    if (params.get("tool")) {
      await waitFor(params.get("tool") === "top-offers" ? ".top-offers-input" : ".sidepanel-gutter");
    } else if (params.get("view") === "guide") {
      (await waitFor<HTMLButtonElement>(".handbook-step-number.is-current")).click();
      await waitFor(".handbook-step-number.is-done");
    } else {
      await waitFor(params.get("state") === "empty" ? ".sidepanel-empty-history"
        : params.get("open") ? ".handbook-guide-title" : ".handbook-row");
      if (params.get("reveal") === "1") {
        (await waitFor<HTMLButtonElement>("[aria-label^='Reveal']")).click();
        await waitFor("[aria-label^='Hide']");
      }
    }
  },
});
