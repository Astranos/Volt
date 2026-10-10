import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { api } from "../../../../../convex/_generated/api";
import {
  adSenseConfiguration,
  requestAdSenseSlot,
  subscribeToAdConsent,
  type AdSenseConfiguration,
} from "../../lib/adsense";
import { CONVEX_URL } from "../../lib/env";
import { authConfigured } from "../app-providers";

function ConsentAd({ configuration }: { configuration: AdSenseConfiguration }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(
    () =>
      subscribeToAdConsent(
        window.__tcfapi,
        configuration.certifiedCmpId,
        setAllowed,
      ),
    [configuration.certifiedCmpId],
  );
  return allowed ? <AdSlot configuration={configuration} /> : null;
}

function AdSlot({ configuration }: { configuration: AdSenseConfiguration }) {
  const slot = useRef<HTMLModElement>(null);
  useEffect(() => {
    if (!slot.current) return;
    return requestAdSenseSlot(
      window,
      document,
      slot.current,
      configuration.publisher,
    );
  }, [configuration.publisher]);
  return (
    <aside
      aria-label="Advertisement"
      className="mt-8 rounded-xl border border-zinc-200 bg-white p-4"
    >
      <p className="mb-3 text-xs text-zinc-500">Advertisement</p>
      <ins
        ref={slot}
        className="adsbygoogle"
        style={{ display: "block", minHeight: 100 }}
        data-ad-client={configuration.publisher}
        data-ad-slot={configuration.slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}

export function freeWorkspaceAllowsAds(
  tier: "free" | "workspace" | undefined,
): boolean {
  return tier === "free";
}

function WorkspaceAdEligibility({
  configuration,
}: {
  configuration: AdSenseConfiguration;
}) {
  const { isAuthenticated } = useConvexAuth();
  const usage = useQuery(
    api.workspaceStorage.getUsage,
    isAuthenticated ? {} : "skip",
  );
  return freeWorkspaceAllowsAds(usage?.tier) ? (
    <ConsentAd configuration={configuration} />
  ) : null;
}

function AdAccountProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  useEffect(() => {
    const connection = new ConvexReactClient(CONVEX_URL, {
      unsavedChangesWarning: false,
    });
    setClient(connection);
    return () => {
      void connection.close();
    };
  }, []);
  return client ? (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  ) : null;
}

function AccountAdEligibility({
  configuration,
}: {
  configuration: AdSenseConfiguration;
}) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <ConsentAd configuration={configuration} />;
  return (
    <AdAccountProvider key={userId}>
      <WorkspaceAdEligibility configuration={configuration} />
    </AdAccountProvider>
  );
}

export class AdEligibilityBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function PublicSearchAd({ usefulResults }: { usefulResults: boolean }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const configuration = adSenseConfiguration(import.meta.env);
  if (!hydrated || !usefulResults || !configuration) return null;
  return (
    <AdEligibilityBoundary>
      {authConfigured ? (
        <AccountAdEligibility configuration={configuration} />
      ) : (
        <ConsentAd configuration={configuration} />
      )}
    </AdEligibilityBoundary>
  );
}
