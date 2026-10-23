import "@/entrypoints/sidepanel/sidepanel.css";
import UnifiedSidepanel from "@/src/components/sidepanel/UnifiedSidepanel";
import { HANDBOOK_OPEN_ENTRY_KEY } from "@/src/domain/handbook";
import { waitFor } from "../dom";
import { handbookGuide, HandbookPreviewProvider } from "../fixtures/handbook";
import { defineScenario } from "../scenario";

// ?view=guide opens the Windows guide with its first step done; ?state=empty shows the starter prompt.
export default defineScenario({
  description: "Sidepanel Handbook tab (?view=guide for step-by-step mode, ?state=empty)",
  viewport: { width: 400, height: 820 },
  chrome: {
    storage: {
      local: {
        sidePanelTool: "handbook",
        // Requested "now" so the panel's freshness check accepts it.
        ...(new URLSearchParams(location.search).get("view") === "guide"
          ? { [HANDBOOK_OPEN_ENTRY_KEY]: { id: handbookGuide._id, requestedAt: Date.now() } }
          : {}),
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
      await waitFor(params.get("state") === "empty" ? ".sidepanel-empty-history" : ".handbook-row");
    }
  },
});
