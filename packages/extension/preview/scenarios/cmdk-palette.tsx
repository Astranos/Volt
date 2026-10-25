import "@/entrypoints/newtab/newtab.css";
import { CMDKPalette } from "@/src/components/cmdk-palette";
import { typeInto, waitFor } from "../dom";
import { handbookMessages } from "../fixtures/handbook";
import { defineScenario } from "../scenario";

// ?q=<text> types into the palette, e.g. q=addr for handbook results.
export default defineScenario({
  description: "Command Menu palette (?q= types a search, e.g. q=addr for handbook results)",
  viewport: { width: 900, height: 560 },
  chrome: { messages: handbookMessages },
  render: () => <CMDKPalette isOpen onClose={() => {}} />,
  act: async (params) => {
    const query = params.get("q");
    if (!query) return;
    await typeInto(".cmdk-input", query);
    await waitFor("[cmdk-item][data-value^='handbook']");
  },
});
