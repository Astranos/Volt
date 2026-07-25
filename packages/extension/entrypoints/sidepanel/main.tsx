import { createRoot } from "react-dom/client";
import { useAuth } from "@clerk/chrome-extension";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import UnifiedSidepanel from "../../src/components/sidepanel/UnifiedSidepanel";
import { SidepanelClerkProvider } from "../../src/components/access/ExtensionAccess";
import { CLERK_PUBLISHABLE_KEY, convexDeploymentUrlFromHttpActionsUrl } from "../../src/access/config";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../../src/domain/mobile-scanner-signal-url";
import "./sidepanel.css";

/**
 * @fileoverview Volt Chrome Extension Side Panel Script
 * @description Manages the side panel functionality with tabbed navigation
 * @version 2.0.0
 * @author Juan Quenga
 * @license MIT
 */

// The panel subscribes to the cloud workspace itself, so it must not depend on
// the offscreen document's Convex client being alive.
const convexClient = new ConvexReactClient(
  convexDeploymentUrlFromHttpActionsUrl(EXTENSION_SCANNER_SIGNAL_URL),
);

// Without a publishable key there is no Clerk to ask, but useConvexAuth still
// throws unless *some* auth provider sits above it — a permanently
// unauthenticated one keeps the panel on its signed-out state instead.
const useNoAuth = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

// Initialize the sidepanel
const initSidepanel = () => {
  const container = document.getElementById("volt-sidepanel-container");
  if (!container) {
    console.error("Sidepanel container not found");
    return;
  }

  const root = createRoot(container);
  root.render(
    <SidepanelClerkProvider>
      {/*
        Without a publishable key SidepanelClerkProvider renders no ClerkProvider,
        and Clerk's useAuth would throw; the static provider still gives the tree
        a Convex client and an auth context, so the panel reports an
        unauthenticated workspace instead of crashing.
      */}
      {CLERK_PUBLISHABLE_KEY ? (
        <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
          <UnifiedSidepanel />
        </ConvexProviderWithClerk>
      ) : (
        <ConvexProviderWithAuth client={convexClient} useAuth={useNoAuth}>
          <UnifiedSidepanel />
        </ConvexProviderWithAuth>
      )}
    </SidepanelClerkProvider>,
  );
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSidepanel, { once: true });
} else {
  initSidepanel();
}
