import type { PropsWithChildren } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  ClerkProvider,
  OrganizationSwitcher,
  SignInButton,
  UserButton,
  useAuth,
  useOrganization,
  useUser,
} from "@clerk/chrome-extension";
import { Building2, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import {
  parseExtensionAccessStatus,
  type ExtensionAccessStatus,
} from "../../access/access-contract";
import { CLERK_PUBLISHABLE_KEY } from "../../access/config";
import { cn } from "../../lib/utils";

type AccessSurface = "popup" | "sidepanel";

function objectFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function ExtensionClerkProvider({ children }: PropsWithChildren) {
  if (!CLERK_PUBLISHABLE_KEY) return children;
  const currentPath =
    location.pathname === "/sidepanel.html"
      ? "/sidepanel.html"
      : "/mobile-scanner-popup.html";
  const currentExtensionPage = chrome.runtime.getURL(currentPath);
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl={currentExtensionPage}
      signInFallbackRedirectUrl={currentExtensionPage}
      signUpFallbackRedirectUrl={currentExtensionPage}
      allowedRedirectProtocols={["chrome-extension:"]}
    >
      {children}
    </ClerkProvider>
  );
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

export function ExtensionAccessPanel({
  surface,
}: {
  surface: AccessSurface;
}) {
  if (!CLERK_PUBLISHABLE_KEY) {
    return <MissingClerkConfiguration surface={surface} />;
  }
  return <ClerkAccessPanel surface={surface} />;
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

  return (
    <section
      className={cn(
        "rounded-xl border border-border/70 bg-background/75 px-3 py-2 shadow-sm backdrop-blur",
        surface === "sidepanel" ? "mx-3 mt-2" : "mt-2",
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
          <SignInButton mode="modal">
            <button
              type="button"
              className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-700"
            >
              Sign in
            </button>
          </SignInButton>
        )}
      </div>

      {isSignedIn ? (
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
