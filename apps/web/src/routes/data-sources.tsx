import { createFileRoute } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Chrome,
  Highlighter,
  Link2,
  MessageSquareMore,
  RefreshCw,
  Search,
  ShoppingBag,
  Smartphone,
  Store,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "../site-chrome";

export const Route = createFileRoute("/data-sources")({
  head: () => ({
    meta: [
      {
        name: "description",
        content:
          "Every Volt feature and the services it talks to. Volt runs on Chrome, Shopify, and Volt’s own backend.",
      },
    ],
    title: "Where Volt Gets Its Data - Volt",
  }),
  component: DataSourcesPage,
});

type Feature = {
  icon: LucideIcon;
  name: string;
  talksTo: string[];
  detail: string;
};

type Group = {
  icon: LucideIcon;
  title: string;
  summary: string;
  features: Feature[];
};

const groups: Group[] = [
  {
    icon: Chrome,
    title: "Chrome extension",
    summary: "Tools that run in your browser and sync with your Volt account.",
    features: [
      {
        icon: RefreshCw,
        name: "Mobile capture sync and QR sign-in",
        talksTo: ["Volt account", "Clerk sign-in", "Google sign-in"],
        detail:
          "Barcodes, text, and photos from the iPhone app arrive through your own Volt account. The older direct pairing connects phone and computer through Google STUN and Cloudflare TURN.",
      },
      {
        icon: Search,
        name: "Search shortcuts and context menu",
        talksTo: ["Only the site you pick"],
        detail:
          "Builds a search link for eBay, PriceCharting, Google, and others, and opens it when you click. Results are never downloaded or stored.",
      },
      {
        icon: TriangleAlert,
        name: "eBay sold-listing warning",
        talksTo: ["ebay.com, in your browser"],
        detail: "Adds a notice to eBay search pages you open. Nothing is sent anywhere.",
      },
      {
        icon: Highlighter,
        name: "UPC highlighter, link preview, and field insertion",
        talksTo: ["The page you’re on"],
        detail:
          "Highlights barcodes, previews links on Shift+click, and types mobile captures into the field you pick. Page contents stay in your browser.",
      },
      {
        icon: Link2,
        name: "Quick links and bookmarks",
        talksTo: ["Google Sheets (CSV)", "Google favicons"],
        detail:
          "Quick links come from a published sheet you can replace in Settings. Link icons fall back to Google’s favicon service.",
      },
      {
        icon: BookOpen,
        name: "Handbook",
        talksTo: ["Volt account"],
        detail: "Notes, guides, and saved values live in your own Volt account. Saved secrets are encrypted.",
      },
    ],
  },
  {
    icon: Smartphone,
    title: "iPhone app",
    summary: "Capture on the phone, pick up on any screen.",
    features: [
      {
        icon: Zap,
        name: "Capture, 7-day history, and sync",
        talksTo: ["Volt account", "Clerk sign-in"],
        detail:
          "Barcode and text recognition run on the iPhone. Synced captures go to your Volt workspace and clear after 7 days.",
      },
      {
        icon: Smartphone,
        name: "App Clip",
        talksTo: ["Volt account"],
        detail: "Sends captures to your workspace with a short-lived pass from your signed-in Chrome. No account needed on the phone.",
      },
    ],
  },
  {
    icon: Store,
    title: "In-store kiosk",
    summary: "A customer catalog for store iPads and tablets.",
    features: [
      {
        icon: ShoppingBag,
        name: "In-store catalog",
        talksTo: ["Volt kiosk server", "*.myshopify.com", "cdn.shopify.com"],
        detail:
          "Shows a store’s public Shopify listings, read straight from its Shopify store address. Branding is built into the kiosk.",
      },
      {
        icon: MessageSquareMore,
        name: "Ask to see an item",
        talksTo: ["Volt account"],
        detail: "Customer requests go to a short-lived staff queue and expire after one hour.",
      },
    ],
  },
];

function DataSourcesPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-zinc-200 bg-white">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgba(16,185,129,0.10),transparent)]" />
          <div className="relative mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:py-20">
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Updated November 13, 2026
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
              Where Volt gets its data
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-600">
              Volt runs on Chrome, Shopify, and Volt’s own backend. It doesn’t depend on any
              franchise’s or retailer’s private systems, so it works for any resale business.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-4xl space-y-16 px-4 py-16 sm:px-6 lg:py-20">
          {groups.map((group) => (
            <section key={group.title} aria-labelledby={`group-${group.title}`}>
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-zinc-950 text-white">
                  <group.icon size={19} />
                </div>
                <div>
                  <h2 id={`group-${group.title}`} className="text-xl font-semibold">
                    {group.title}
                  </h2>
                  <p className="text-sm text-zinc-500">{group.summary}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {group.features.map((feature) => (
                  <article
                    key={feature.name}
                    className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                        <feature.icon size={17} />
                      </div>
                      <h3 className="pt-1.5 text-sm font-semibold leading-5">{feature.name}</h3>
                    </div>
                    <p className="mt-3 flex-1 text-sm leading-6 text-zinc-600">{feature.detail}</p>
                    <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Talks to">
                      {feature.talksTo.map((service) => (
                        <li
                          key={service}
                          className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-medium text-zinc-700"
                        >
                          {service}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
