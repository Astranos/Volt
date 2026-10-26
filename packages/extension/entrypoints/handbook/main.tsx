import { createRoot } from "react-dom/client";
import { useAuth } from "@clerk/chrome-extension";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import HandbookPage from "../../src/components/handbook/HandbookPage";
import { SidepanelClerkProvider } from "../../src/components/access/ExtensionAccess";
import { CLERK_PUBLISHABLE_KEY, convexDeploymentUrlFromHttpActionsUrl } from "../../src/access/config";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../../src/domain/mobile-scanner-signal-url";
import "../sidepanel/sidepanel.css";

// Same provider stack as the sidepanel: Clerk identity, Convex data.
const convexClient = new ConvexReactClient(convexDeploymentUrlFromHttpActionsUrl(EXTENSION_SCANNER_SIGNAL_URL));
const useNoAuth = () => ({ isLoading: false, isAuthenticated: false, fetchAccessToken: async () => null });

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <SidepanelClerkProvider page="/handbook.html">
      {CLERK_PUBLISHABLE_KEY ? (
        <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
          <HandbookPage />
        </ConvexProviderWithClerk>
      ) : (
        <ConvexProviderWithAuth client={convexClient} useAuth={useNoAuth}>
          <HandbookPage />
        </ConvexProviderWithAuth>
      )}
    </SidepanelClerkProvider>,
  );
}
