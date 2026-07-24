import type { ErrorInfo, ReactNode } from "react";
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  ClerkLoaded,
  ClerkLoading,
  ClerkProvider,
  OrganizationSwitcher,
  UserButton,
  useAuth,
  useOrganization,
  useUser,
} from "@clerk/chrome-extension";
import { Building2, ExternalLink, LogIn, RefreshCw, ShieldCheck } from "lucide-react";
import {
  parseExtensionAccessStatus,
  type ExtensionAccessStatus,
} from "../../access/access-contract";
import {
  CLERK_PUBLISHABLE_KEY,
  CLERK_SIGN_IN_URL,
  CLERK_SYNC_HOST,
} from "../../access/config";
import { publishClerkConvexToken } from "../../access/clerk-convex-token";
import { cn } from "../../lib/utils";

type AccessSurface = "popup" | "sidepanel";
type AccountControlSurface = "newtab" | "sidepanel";
type ClerkTokenGetter = () => Promise<string | null>;

const SidepanelClerkTokenContext = createContext<ClerkTokenGetter>(async () => null);

function accountControlClassName(
  surface: AccountControlSurface,
  state: string,
) {
  return `${surface}-account-control ${state}`;
}

function isClerkReturnUrl(value: string | undefined) {
  if (!value) return false;
  try {
    return new URL(value).origin === "https://volt.juanquenga.com";
  } catch {
    return false;
  }
}

function useClerkReturnReload() {
  useEffect(() => {
    let reloadStarted = false;
    const handleTabUpdated: Parameters<
      typeof chrome.tabs.onUpdated.addListener
    >[0] = (_tabId, changeInfo, tab) => {
      if (reloadStarted || changeInfo.status !== "complete") return;
      if (!isClerkReturnUrl(changeInfo.url ?? tab.url)) return;
      reloadStarted = true;
      window.location.reload();
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    return () => chrome.tabs.onUpdated.removeListener(handleTabUpdated);
  }, []);
}

function SidepanelClerkTokenBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const getFreshToken = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return null;
    return getToken({ template: "convex", skipCache: true });
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;

    const publish = async () => {
      if (!isSignedIn) {
        await publishClerkConvexToken(null);
        return;
      }
      const token = await getFreshToken();
      if (cancelled) return;
      await publishClerkConvexToken(token);
    };

    void publish();
    const intervalId = window.setInterval(() => {
      void publish();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [getFreshToken, isLoaded, isSignedIn]);

  return (
    <SidepanelClerkTokenContext.Provider value={getFreshToken}>
      {children}
    </SidepanelClerkTokenContext.Provider>
  );
}

export function SidepanelClerkProvider({ children }: { children: ReactNode }) {
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <SidepanelClerkTokenContext.Provider value={async () => null}>
        {children}
      </SidepanelClerkTokenContext.Provider>
    );
  }

  const currentExtensionPage = chrome.runtime.getURL("/sidepanel.html");
  return (
    <ClerkProvider
      __experimental_syncHostListener
      publishableKey={CLERK_PUBLISHABLE_KEY}
      syncHost={CLERK_SYNC_HOST}
      afterSignOutUrl={currentExtensionPage}
      signInFallbackRedirectUrl={currentExtensionPage}
      signUpFallbackRedirectUrl={currentExtensionPage}
      allowedRedirectProtocols={["chrome-extension:"]}
    >
      <SidepanelClerkTokenBridge>{children}</SidepanelClerkTokenBridge>
    </ClerkProvider>
  );
}

export function useSidepanelClerkToken() {
  return useContext(SidepanelClerkTokenContext);
}

function objectFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function statusCopy(status: ExtensionAccessStatus | null) {
  if (!status) return "Checking scanner access";
  switch (status.access) {
    case "trial":
      return `${status.freeSessionsRemaining} free session${
        status.freeSessionsRemaining === 1 ? "" : "s"
      } remaining`;
    case "complimentary":
      return "Complimentary workplace access";
    case "subscription":
      return "Volt Pro subscription active";
    case "exhausted":
      return status.requiresSignIn
        ? "Five free sessions used"
        : status.subscriptionStatus === "expired"
          ? "Volt Pro subscription expired"
          : "Volt Pro subscription required";
  }
}

function MissingClerkConfiguration({ surface }: { surface: AccessSurface }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200",
        surface === "sidepanel" ? "mx-3 mt-2" : "mt-2",
      )}
    >
      Set <code>WXT_CLERK_PUBLISHABLE_KEY</code> to enable account access.
    </div>
  );
}

function AccountAccessMessage({
  surface,
  message,
}: {
  surface: AccessSurface;
  message: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-background/75 px-3 py-2 text-[11px] text-muted-foreground shadow-sm",
        surface === "sidepanel" ? "mx-3 mt-2" : "mt-2",
      )}
      aria-live="polite"
    >
      {message}
    </div>
  );
}

class ExtensionAccessErrorBoundary extends Component<
  { children: ReactNode; surface: AccessSurface },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Volt account access failed", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <AccountAccessMessage
          surface={this.props.surface}
          message="Account access is temporarily unavailable. Scanner tools are still ready."
        />
      );
    }
    return this.props.children;
  }
}

export function ExtensionAccessPanel({
  surface,
}: {
  surface: AccessSurface;
}) {
  if (!CLERK_PUBLISHABLE_KEY) {
    return <MissingClerkConfiguration surface={surface} />;
  }
  const currentExtensionPage = chrome.runtime.getURL(
    surface === "sidepanel" ? "/sidepanel.html" : "/mobile-scanner-popup.html",
  );
  return (
    <ExtensionAccessErrorBoundary surface={surface}>
      <ClerkProvider
        __experimental_syncHostListener
        publishableKey={CLERK_PUBLISHABLE_KEY}
        syncHost={CLERK_SYNC_HOST}
        afterSignOutUrl={currentExtensionPage}
        signInFallbackRedirectUrl={currentExtensionPage}
        signUpFallbackRedirectUrl={currentExtensionPage}
        allowedRedirectProtocols={["chrome-extension:"]}
      >
        <ClerkLoading>
          <AccountAccessMessage
            surface={surface}
            message="Connecting Volt account…"
          />
        </ClerkLoading>
        <ClerkLoaded>
          <ClerkAccessPanel surface={surface} />
        </ClerkLoaded>
      </ClerkProvider>
    </ExtensionAccessErrorBoundary>
  );
}

class ExtensionAccountControlErrorBoundary extends Component<
  { children: ReactNode; surface: AccountControlSurface },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Volt account control failed", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <span
          className={accountControlClassName(this.props.surface, "is-unavailable")}
          title="Account unavailable"
        >
          <LogIn />
        </span>
      );
    }
    return this.props.children;
  }
}

export function ExtensionAccountControl({
  surface = "sidepanel",
  sharedClerkContext = false,
}: {
  surface?: AccountControlSurface;
  sharedClerkContext?: boolean;
}) {
  useClerkReturnReload();
  if (!CLERK_PUBLISHABLE_KEY) return null;
  const currentExtensionPage = chrome.runtime.getURL(
    surface === "newtab" ? "/newtab.html" : "/sidepanel.html",
  );

  const control = (
    <>
      <ClerkLoading>
        <span
          className={accountControlClassName(surface, "is-loading")}
          aria-label="Loading Volt account"
        />
      </ClerkLoading>
      <ClerkLoaded>
        <ClerkAccountControl surface={surface} />
      </ClerkLoaded>
    </>
  );

  return (
    <ExtensionAccountControlErrorBoundary surface={surface}>
      {sharedClerkContext ? control : (
        <ClerkProvider
          __experimental_syncHostListener
          publishableKey={CLERK_PUBLISHABLE_KEY}
          syncHost={CLERK_SYNC_HOST}
          afterSignOutUrl={currentExtensionPage}
          signInFallbackRedirectUrl={currentExtensionPage}
          signUpFallbackRedirectUrl={currentExtensionPage}
          allowedRedirectProtocols={["chrome-extension:"]}
        >
          {control}
        </ClerkProvider>
      )}
    </ExtensionAccountControlErrorBoundary>
  );
}

function ClerkAccountControl({ surface }: { surface: AccountControlSurface }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    void chrome.runtime
      .sendMessage({ action: "accessAuthChanged" })
      .catch(() => undefined);
  }, [isLoaded, isSignedIn, user?.id]);

  if (isSignedIn) {
    return (
      <span
        className={accountControlClassName(surface, "is-signed-in")}
        title={user?.fullName ? `Volt account: ${user.fullName}` : "Volt account"}
      >
        <UserButton />
      </span>
    );
  }

  return (
    <button
      type="button"
      className={accountControlClassName(surface, "is-signed-out")}
      onClick={() => void chrome.tabs.create({ url: CLERK_SIGN_IN_URL })}
      title="Sign in to Volt"
    >
      <LogIn />
      <span>Sign in</span>
    </button>
  );
}

function ClerkAccessPanel({ surface }: { surface: AccessSurface }) {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { organization } = useOrganization();
  const [status, setStatus] = useState<ExtensionAccessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const applyResponse = useCallback((response: unknown) => {
    const record = objectFrom(response);
    const nextStatus = parseExtensionAccessStatus(
      record?.status ?? record?.accessStatus,
    );
    if (nextStatus) {
      setStatus(nextStatus);
      setError(null);
      return;
    }
    if (typeof record?.error === "string") setError(record.error);
  }, []);

  const refresh = useCallback(
    async (authChanged = false) => {
      setRefreshing(true);
      try {
        const response = await chrome.runtime.sendMessage({
          action: authChanged ? "accessAuthChanged" : "accessGetStatus",
        });
        applyResponse(response);
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "Unable to load scanner access",
        );
      } finally {
        setRefreshing(false);
      }
    },
    [applyResponse],
  );

  useEffect(() => {
    if (!authLoaded) return;
    void refresh(true);
  }, [authLoaded, isSignedIn, organization?.id, refresh, user?.id]);

  useEffect(() => {
    const listener = (message: unknown) => {
      const record = objectFrom(message);
      if (record?.action !== "accessStatusChanged") return;
      const nextStatus = parseExtensionAccessStatus(record.status);
      if (nextStatus) setStatus(nextStatus);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const accountName = isSignedIn
    ? user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Signed in"
    : "Guest";
  const workspaceName = organization?.name ?? "Personal workspace";
  const exhausted = status?.access === "exhausted";
  const openWebSignIn = () => {
    void chrome.tabs.create({ url: CLERK_SIGN_IN_URL });
  };

  return (
    <section
      className={cn(
        "rounded-xl border border-border/70 bg-background/75 px-3 py-2 shadow-sm backdrop-blur",
        surface === "sidepanel" ? "mx-3 mt-2" : "volt-access-panel--popup mt-2",
      )}
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <ShieldCheck
          className={cn(
            "h-4 w-4 shrink-0",
            status?.isAuthorized ? "text-emerald-600" : "text-amber-600",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-bold text-foreground">
            {statusCopy(status)}
          </div>
          <div className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
            <span className="truncate">{accountName}</span>
            <span aria-hidden="true">·</span>
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{workspaceName}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Refresh scanner access"
          title="Refresh scanner access"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </button>
        {isSignedIn ? (
          <UserButton />
        ) : (
          <button
            type="button"
            onClick={openWebSignIn}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-700"
            title="Sign in to Volt in a browser tab"
          >
            Sign in
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>

      {isSignedIn && surface === "sidepanel" ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
          <span className="text-[10px] font-medium text-muted-foreground">
            Workspace
          </span>
          <OrganizationSwitcher hidePersonal={false} />
        </div>
      ) : null}

      {exhausted ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-amber-500/20 pt-1.5">
          <p className="m-0 text-[10px] leading-tight text-amber-700 dark:text-amber-300">
            {status.requiresSignIn
              ? "Sign in, then subscribe in Volt for iPhone if needed."
              : "Checkout is available only in the full iPhone app."}
          </p>
          <button
            type="button"
            onClick={() =>
              void chrome.runtime.sendMessage({ action: "accessOpenFullApp" })
            }
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
          >
            Get app
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="m-0 mt-1 text-[10px] text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  );
}
