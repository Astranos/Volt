import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/clerk-react";

import { CLERK_PUBLISHABLE_KEY } from "../lib/env";

/**
 * The marketing pages have to render even when no publishable key was baked
 * into the build, so auth is treated as an optional capability rather than a
 * hard dependency. Anything that calls a Clerk hook must sit behind this flag.
 */
export const authConfigured = CLERK_PUBLISHABLE_KEY.length > 0;

/** Clerk's own components, dressed like the rest of the site. */
const clerkAppearance = {
  variables: {
    colorPrimary: "#059669",
    colorText: "#09090b",
    colorTextSecondary: "#52525b",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    colorDanger: "#dc2626",
    borderRadius: "0.85rem",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none border-none",
    card: "bg-transparent shadow-none border-none p-0",
    header: "text-left",
    headerTitle: "text-2xl font-semibold text-zinc-950",
    headerSubtitle: "text-sm leading-6 text-zinc-600",
    socialButtonsBlockButton:
      "h-11 rounded-[0.85rem] border-zinc-300 hover:border-zinc-950 text-sm font-semibold",
    dividerLine: "bg-zinc-200",
    dividerText: "text-xs font-semibold uppercase tracking-wide text-zinc-400",
    formFieldLabel: "text-sm font-medium text-zinc-700",
    formFieldInput:
      "h-11 rounded-[0.85rem] border-zinc-300 focus:border-emerald-600",
    formButtonPrimary:
      "h-11 rounded-[0.85rem] bg-zinc-950 hover:bg-zinc-800 text-sm font-semibold normal-case shadow-none",
    footer: "bg-transparent",
    footerActionText: "text-sm text-zinc-600",
    footerActionLink: "text-sm font-semibold text-emerald-700 hover:text-emerald-800",
    userButtonPopoverCard: "rounded-[1.2rem] border border-zinc-200 shadow-xl",
    userButtonPopoverActionButton: "text-sm",
  },
} as const;

export function AppProviders({ children }: { children: ReactNode }) {
  if (!authConfigured) return <>{children}</>;
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={clerkAppearance}
      // Without these, Clerk sends redirects to the hosted Account Portal
      // instead of the sign-in pages this app already renders.
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      {children}
    </ClerkProvider>
  );
}
