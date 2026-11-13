import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader, supportUrl } from "../site-chrome";

export const Route = createFileRoute("/data-sources")({
  head: () => ({
    meta: [
      {
        name: "description",
        content:
          "Every Volt feature and the services it talks to. Volt runs on Chrome, Shopify, and its own backend, and does not use paymore.com services.",
      },
    ],
    title: "Where Volt Gets Its Data - Volt",
  }),
  component: DataSourcesPage,
});

type Feature = { name: string; talksTo: ReactNode; detail: ReactNode };

const extensionFeatures: Feature[] = [
  {
    name: "Shopify admin buttons, product search, and Shopify Audit",
    talksTo: <>admin.shopify.com, your store’s *.myshopify.com admin, and the Shopify Admin API</>,
    detail:
      "Runs only inside your own Shopify admin. Inventory search and audits use the Shopify Admin API with the access your store granted when it installed Volt.",
  },
  {
    name: "Mobile capture sync and QR sign-in",
    talksTo: <>Volt’s backend (Convex, Cloudflare R2) and Clerk for sign-in</>,
    detail:
      "Barcodes, text, and photos from the Volt iPhone app arrive through your own Volt account. Chrome profile sign-in checks your Google account with Google’s sign-in service.",
  },
  {
    name: "Search shortcuts, context menu, and new tab search",
    talksTo: <>Nothing until you click; then the site you chose (eBay, PriceCharting, Google, BarcodeLookup, and others)</>,
    detail:
      "These build a search link and open it in a new tab. Volt does not download or store results from those sites.",
  },
  {
    name: "eBay sold-listing warning",
    talksTo: <>www.ebay.com search pages, in your browser only</>,
    detail: "Adds a notice to eBay search pages you open. It reads that page and sends nothing anywhere.",
  },
  {
    name: "UPC highlighter, link preview, and field insertion",
    talksTo: <>The page you are viewing, in your browser only</>,
    detail:
      "These run on whatever page you have open so they can highlight barcodes, preview a link on Shift+click, or type a mobile capture into the field you picked. They do not send page contents to Volt or anyone else.",
  },
  {
    name: "Quick links in the command palette",
    talksTo: <>A published Google Sheet (CSV) that you can replace in Settings</>,
    detail: "The sheet is a list of bookmarks. Volt opens a link only when you choose it.",
  },
  {
    name: "QR code tool",
    talksTo: <>api.qrserver.com</>,
    detail: "Turns text you select into a QR code image.",
  },
];

const appFeatures: Feature[] = [
  {
    name: "Capture, 7-day history, and workspace sync",
    talksTo: <>Volt’s backend (Convex, Cloudflare R2) and Clerk for sign-in</>,
    detail:
      "Barcode and text recognition run on the iPhone. Synced captures go to your own Volt workspace and roll off after 7 days.",
  },
  {
    name: "App Clip",
    talksTo: <>Volt’s backend, with a short-lived pass from your signed-in Chrome</>,
    detail: "Sends captures to your workspace without an account on the phone.",
  },
];

const kioskFeatures: Feature[] = [
  {
    name: "In-store catalog",
    talksTo: <>The store’s own *.myshopify.com storefront (products.json, meta.json) and cdn.shopify.com for photos</>,
    detail:
      "The kiosk shows a store’s public Shopify listings straight from Shopify. A store is identified by its Shopify shop address, so any Shopify store can use it. The store name and logo on screen are that store’s branding, not a data source.",
  },
  {
    name: "Ask to see an item",
    talksTo: <>Volt’s backend</>,
    detail: "Customer requests go to a short-lived queue that store staff see. Requests expire after one hour.",
  },
];

const notUsed = [
  "paymore.com websites, storefront domains, or APIs",
  "The paymore.com point-of-sale system",
  "Product, price, or UPC data collected from paymore.com. Volt deleted that data and the features built on it, including UPC search and the product API.",
  "Account access tied to a paymore.com email. Every signed-in account gets the same free access.",
];

function DataSourcesPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-24">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-green-700">
          Volt
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Where Volt gets its data
        </h1>
        <p className="mt-4 text-sm text-zinc-500">Updated November 13, 2026</p>

        <div className="mt-12 space-y-12 text-base leading-7 text-zinc-700">
          <p>
            Volt runs on Chrome, Shopify, and Volt’s own backend. It does not depend on any
            franchise’s or retailer’s private systems, so the extension, iPhone app, and kiosk work
            for any resale business. This page lists every feature in use and what it talks to.
          </p>

          <Section title="Chrome extension">
            <FeatureList features={extensionFeatures} />
          </Section>

          <Section title="Volt iPhone app">
            <FeatureList features={appFeatures} />
          </Section>

          <Section title="In-store kiosk">
            <FeatureList features={kioskFeatures} />
          </Section>

          <Section title="What Volt does not use">
            <ul className="list-disc space-y-2 pl-5">
              {notUsed.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Section>

          <Section title="Volt’s backend">
            <p>
              “Volt’s backend” means services Volt runs for its own users: Convex for accounts and
              sync, Cloudflare R2 for photos, and Clerk for sign-in. Volt’s server also talks to
              Shopify for connected stores, Apple for legacy App Store subscriptions, and OpenRouter
              and PriceCharting search for product lookups requested by older app versions.
            </p>
          </Section>

          <Section title="Check it yourself">
            <p>
              The extension’s permissions are listed on its page in{" "}
              <code className="rounded bg-zinc-200 px-1 text-sm">chrome://extensions</code>. Volt’s
              source code is public, so you can search it for any domain. Questions go to{" "}
              <a className="font-semibold text-green-700 underline" href={supportUrl}>
                Volt support
              </a>
              .
            </p>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function FeatureList({ features }: Readonly<{ features: Feature[] }>) {
  return (
    <ul className="space-y-6">
      {features.map((feature) => (
        <li key={feature.name}>
          <h3 className="font-semibold text-zinc-950">{feature.name}</h3>
          <p className="mt-1 text-sm text-zinc-500">Talks to: {feature.talksTo}</p>
          <p className="mt-1">{feature.detail}</p>
        </li>
      ))}
    </ul>
  );
}

function Section({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-zinc-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
