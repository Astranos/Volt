import "@/entrypoints/sidepanel/sidepanel.css";
import { ChromeProfileSignIn } from "@/src/components/access/ExtensionAccess";
import { EmptyHistory } from "@/src/components/sidepanel/mobile-scanner-cards";
import { SIDEPANEL_TOOLS } from "@/src/lib/sidepanel-tools";
import { waitFor } from "../dom";
import { defineScenario } from "../scenario";

const noop = () => {};

// Mirrors UnifiedSidepanel's header (which needs a live Clerk session) around
// the real signed-out controls. ?state=card shows the body after "Sign in to
// Volt"; ?state=error shows a failed header sign-in.
export default defineScenario({
  description: "Signed-out sidepanel header + scanner body (?state=card|error)",
  viewport: { width: 380, height: 640 },
  chrome: {
    messages: { chromeProfileSignIn: () => ({ success: false, error: "account_not_linked" }) },
  },
  render: (params) => {
    const state = params.get("state");
    return (
      <div id="volt-sidepanel-container" style={{ height: "100vh" }}>
        <div className="sidepanel-shell sidepanel-frame h-full w-full flex flex-col">
          <div className="sidepanel-content-frame flex flex-1 flex-col overflow-hidden">
            <div className="sidepanel-tool-header">
              <div className="sidepanel-tool-row">
                <div className="sidepanel-tool-tabs" role="tablist">
                  {SIDEPANEL_TOOLS.map((tool) => (
                    <button key={tool.id} type="button" role="tab" className={`sidepanel-tool-tab${tool.id === "mobile-scanner" ? " is-active" : ""}`}>
                      <span className="sidepanel-tool-tab-icon"><tool.icon /></span>
                      <span className="sidepanel-tool-tab-label"><span>{tool.label}</span></span>
                    </button>
                  ))}
                </div>
                <ChromeProfileSignIn surface="sidepanel" layout="compact" />
              </div>
            </div>
            <div className="min-h-0 flex-1 px-4 pb-4">
              {state === "card"
                ? <div className="px-4 pb-4"><ChromeProfileSignIn layout="card" /></div>
                : <EmptyHistory signedOut onSignIn={noop} />}
            </div>
          </div>
        </div>
      </div>
    );
  },
  act: async (params) => {
    if (params.get("state") !== "error") return;
    (await waitFor<HTMLButtonElement>(".sidepanel-tool-row .sidepanel-account-control")).click();
    await waitFor(".extension-profile-sign-in-error");
  },
});
