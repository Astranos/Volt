import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  Bookmark,
  Calculator,
  Chrome,
  ClipboardList,
  ExternalLink,
  Image as ImageIcon,
  PackageSearch,
  RotateCcw,
  ScanBarcode,
  Search,
  Smartphone,
} from "lucide-react";

import {
  chromeExtensionDownloadUrl,
  mobileAppDownloadUrl,
  SiteFooter,
  SiteHeader,
} from "../site-chrome";

export const Route = createFileRoute("/")({
  component: Home,
});

const browserFeatures = [
  {
    icon: Search,
    title: "Provider search",
    body: "Search Google, eBay solds, PriceCharting, UPC sources, and Shopify inventory from one browser surface.",
  },
  {
    icon: Calculator,
    title: "Offer calculator",
    body: "Turn target resale prices into buy offers with configurable margin rules close to the listing workflow.",
  },
  {
    icon: ClipboardList,
    title: "Capture inbox",
    body: "Receive barcodes, OCR text, dictation, and photos from the iPhone scanner without leaving Chrome.",
  },
  {
    icon: PackageSearch,
    title: "Marketplace helpers",
    body: "Use sold-listing warnings, UPC highlighting, Shopify shortcuts, and tab recovery while pricing inventory.",
  },
];

const mobileScreenshots = [
  {
    src: "/assets/product/mobile-02-capture-text-chip.png",
    title: "Text mode",
    body: "Aim at labels, model numbers, and serials while keeping capture controls close.",
  },
  {
    src: "/assets/product/mobile-03-capture-text-extracted.png",
    title: "OCR extraction",
    body: "Clean recognized text before it moves into the browser workflow.",
  },
  {
    src: "/assets/product/mobile-04-capture-send-popup.png",
    title: "Send confirmation",
    body: "Confirm exactly what is being sent to the paired Chrome session.",
  },
  {
    src: "/assets/product/mobile-05-capture-barcode-detected.png",
    title: "Barcode capture",
    body: "Detect UPCs and product codes from retail packaging.",
  },
  {
    src: "/assets/product/mobile-06-capture-photo-viewfinder.png",
    title: "Listing photos",
    body: "Take product photos in the same scanner session.",
  },
  {
    src: "/assets/product/mobile-07-capture-results.png",
    title: "Capture results",
    body: "Review the mixed queue of text, barcodes, and photos.",
  },
  {
    src: "/assets/product/mobile-08-dictation.png",
    title: "Dictation",
    body: "Speak listing notes and send them to Chrome as text.",
  },
  {
    src: "/assets/product/mobile-09-upload-batches.png",
    title: "Upload batches",
    body: "Track photo transfer batches during desktop handoff.",
  },
  {
    src: "/assets/product/mobile-01-connected-sessions.png",
    title: "Saved sessions",
    body: "Reconnect the iPhone scanner to a trusted browser session.",
  },
];

const platformItems = [
  {
    icon: ScanBarcode,
    title: "Extract details",
    body: "Point the iPhone at labels, model numbers, serials, and device screens to capture text when the phone is faster than typing.",
  },
  {
    icon: ImageIcon,
    title: "Capture photos",
    body: "Take listing photos from the same mobile workflow and send them back to the browser alongside the rest of the item information.",
  },
  {
    icon: ClipboardList,
    title: "Dictate notes",
    body: "Speak condition notes, bundle details, accessories, and listing copy into the phone, then send the text directly into Chrome.",
  },
];

const extensionScreenshots = {
  activeWarning: "/assets/extension/ebay-sold-listing-warning.png",
  contextMenu: "/assets/extension/quick-actions.png",
  shopify: "/assets/extension/shopify-buttons.png",
  upc: "/assets/extension/upc-highlighter.png",
};

function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <SiteHeader anchorPrefix="" />

      <section id="top" className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
          <div className="mx-auto max-w-5xl text-center">
            <h1 className="text-4xl font-semibold leading-[1.02] text-zinc-950 sm:text-6xl">
              The fastest way to resell electronics.
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-zinc-600 sm:text-xl">
              Volt is a set of tools that makes buying and reselling quicker by
              streamlining the process of evaluating items, capturing details,
              and preparing listings.
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href={chromeExtensionDownloadUrl}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[0.85rem] bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Download Chrome extension
                <Chrome size={16} />
              </a>
              <a
                href={mobileAppDownloadUrl}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-800 hover:border-zinc-950"
              >
                Download mobile app
                <Smartphone size={16} />
              </a>
            </div>
          </div>
          <HeroPanel />
        </div>
      </section>

      <ProductSurfaceSection />
      <CaptureSection />
      <SiteFooter />
    </main>
  );
}

function HeroPanel() {
  return (
    <div className="mx-auto mt-8 max-w-6xl lg:mt-10">
      <div className="lg:hidden">
        <MobileNewTabDemo />
      </div>
      <div className="hidden lg:block">
        <BrowserWorkspaceMock />
      </div>
    </div>
  );
}

function ProductSurfaceSection() {
  return (
    <section
      id="scanner"
      className="border-b border-zinc-200 bg-zinc-950 text-white"
    >
      <div className="mx-auto max-w-7xl px-4 pt-16 sm:px-6 lg:px-8 lg:pt-24">
        <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr]">
          <div>
            <p className="text-sm font-semibold text-emerald-300">
              Mobile capture
            </p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
              Capture product details with the device already in your hand.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-300">
              The mobile app turns the iPhone camera and microphone into a
              faster input device for resale work: scan labels, read barcodes,
              take photos, and dictate notes without returning to the keyboard
              for every item.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {platformItems.map((item) => (
              <article
                key={item.title}
                className="rounded-[1.2rem] border border-white/10 bg-white/[0.06] p-5"
              >
                <div className="grid size-10 place-items-center rounded-[0.8rem] bg-white text-zinc-950">
                  <item.icon size={20} />
                </div>
                <h3 className="mt-8 text-base font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>

      <div className="py-12 lg:py-16">
        <MobileFeatureCarousel />
      </div>
    </section>
  );
}

function MobileFeatureCarousel() {
  const carouselRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const carousel = carouselRef.current;
    const group = groupRef.current;
    if (!carousel || !group) return;

    let animationFrame = 0;
    let lastTimestamp = performance.now();
    let groupWidth = 0;
    let isWrapping = false;

    const measure = () => {
      groupWidth = group.scrollWidth;
      if (groupWidth > 0 && carousel.scrollLeft < groupWidth * 0.5) {
        carousel.scrollLeft = groupWidth;
      }
    };

    const wrapScrollPosition = () => {
      if (!groupWidth || isWrapping) return;

      if (carousel.scrollLeft <= groupWidth * 0.5) {
        isWrapping = true;
        carousel.scrollLeft += groupWidth;
        isWrapping = false;
      } else if (carousel.scrollLeft >= groupWidth * 1.5) {
        isWrapping = true;
        carousel.scrollLeft -= groupWidth;
        isWrapping = false;
      }
    };

    const animate = (timestamp: number) => {
      const elapsed = timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      if (groupWidth > 0) {
        carousel.scrollLeft += elapsed * 0.035;
        wrapScrollPosition();
      }

      animationFrame = requestAnimationFrame(animate);
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(group);
    carousel.addEventListener("scroll", wrapScrollPosition, { passive: true });
    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      carousel.removeEventListener("scroll", wrapScrollPosition);
    };
  }, []);

  return (
    <div
      ref={carouselRef}
      className="mobile-feature-carousel min-w-0 overflow-x-auto overflow-y-hidden py-1"
      aria-label="Volt mobile capture screenshots"
    >
      <div className="mobile-feature-track flex w-max">
        {[0, 1, 2].map((groupIndex) => (
          <div
            key={groupIndex}
            ref={groupIndex === 0 ? groupRef : undefined}
            className="mobile-feature-group flex shrink-0 gap-4 px-2"
            aria-hidden={groupIndex !== 1}
          >
            {mobileScreenshots.map((item) => (
              <MobileFeatureShot
                key={`${groupIndex}-${item.title}`}
                {...item}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CaptureSection() {
  return (
    <section className="border-b border-zinc-200 bg-zinc-50">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-zinc-500">
              Chrome extension
            </p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-zinc-950 sm:text-4xl">
              Page-aware tools that stay out of the way.
            </h2>
          </div>
          <p className="max-w-xl text-base leading-7 text-zinc-600">
            Volt adds focused controls to the browser surfaces resellers already
            use: UPC pages, product pages, Shopify Admin, and eBay sold-listing
            checks.
          </p>
        </div>

        <div className="mt-10">
          <ChromeExtensionShowcase />
        </div>
      </div>
    </section>
  );
}

function ChromeExtensionShowcase() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <ExtensionFeatureCard
          body="Highlight product text, then open eBay solds, Google UPC, PriceCharting, mobile scanner, offer calculator, or settings."
          image={extensionScreenshots.contextMenu}
          imageClassName="h-[21rem] object-contain"
          mediaClassName="bg-zinc-100 p-4"
          title="Context menu searches"
        />
        <ExtensionFeatureCard
          body="When eBay is showing asking prices, Volt prompts you to switch to sold listings before pricing."
          image={extensionScreenshots.activeWarning}
          imageClassName="h-[21rem] object-contain"
          mediaClassName="bg-zinc-100 p-4"
          title="Active-listing warning"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.88fr_1.12fr]">
        <ExtensionFeatureCard
          body="12-digit UPCs are highlighted inline and copied with one click."
          image={extensionScreenshots.upc}
          imageClassName="h-[14rem] object-contain"
          mediaClassName="bg-zinc-100 p-3"
          title="Click-to-copy UPCs"
        />
        <ExtensionFeatureCard
          body="Open eBay solds or PriceCharting from product title and UPC fields."
          image={extensionScreenshots.shopify}
          imageClassName="h-[14rem] object-contain"
          mediaClassName="bg-zinc-100 p-3"
          title="Shopify search tabs"
        />
      </div>
    </div>
  );
}

function ExtensionFeatureCard({
  body,
  image,
  imageClassName,
  mediaClassName,
  title,
}: {
  body: string;
  image: string;
  imageClassName: string;
  mediaClassName: string;
  title: string;
}) {
  return (
    <article className="overflow-hidden rounded-[1.2rem] border border-zinc-200 bg-white shadow-sm">
      <div
        className={`overflow-hidden border-b border-zinc-200 ${mediaClassName}`}
      >
        <div className="overflow-hidden rounded-[0.85rem] bg-white">
          <img
            src={image}
            alt={`${title} demo`}
            className={`w-full ${imageClassName}`}
          />
        </div>
      </div>
      <div className="p-5">
        <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-600">{body}</p>
      </div>
    </article>
  );
}

function PairingStatus({
  status,
}: {
  status: "ready" | "paired" | "inactive";
}) {
  const statusConfig = {
    ready: {
      label: "Pairing ready",
      text: "text-amber-700",
    },
    paired: {
      label: "Paired",
      text: "text-emerald-700",
    },
    inactive: {
      label: "Inactive",
      text: "text-zinc-600",
    },
  }[status];

  return (
    <div
      className={`inline-flex items-center gap-2 text-sm font-semibold ${statusConfig.text}`}
    >
      <Smartphone size={18} />
      {statusConfig.label}
    </div>
  );
}

function BrowserWorkspaceMock() {
  return (
    <div className="overflow-hidden rounded-[1.35rem] border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/15">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-emerald-500" />
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
          <Chrome size={14} />
          Volt Chrome extension
        </div>
      </div>
      <div className="relative min-h-[44rem] overflow-hidden bg-gradient-to-b from-white to-zinc-100 px-5 py-5 sm:px-8 lg:px-12">
        <div className="absolute left-1/2 top-0 size-[44rem] -translate-x-1/2 rounded-full bg-emerald-200/45 blur-3xl" />
        <div className="relative mx-auto max-w-5xl">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/favicon.svg" alt="" className="size-8" />
              <h3 className="text-base font-semibold text-zinc-950">Volt</h3>
            </div>
            <PairingStatus status="paired" />
          </div>

          <div className="text-center">
            <p className="text-sm font-semibold text-zinc-600">Good evening</p>
            <div className="mt-1 flex items-baseline justify-center gap-2 text-zinc-950">
              <span className="text-6xl font-bold leading-none tracking-tight">
                7:21
              </span>
              <span className="text-xl font-semibold">PM</span>
            </div>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400">
              Sunday, June 21
            </p>
          </div>

          <section className="mx-auto mt-8 max-w-[50rem] overflow-hidden rounded-[1.35rem] border border-zinc-200 bg-white/85 shadow-2xl shadow-zinc-950/10 backdrop-blur">
            <div className="grid gap-3 border-b border-zinc-200 p-4 lg:grid-cols-[minmax(16rem,1fr)_auto] lg:items-center">
              <div className="flex min-w-0 items-center gap-3 text-zinc-400">
                <Search size={18} />
                <span className="truncate text-base">
                  Search eBay sold prices
                </span>
              </div>
              <div className="flex w-fit items-center gap-1 rounded-[1.15rem] border border-zinc-200 bg-zinc-100 p-1 text-xs font-semibold text-zinc-600">
                {["Google", "PriceCharting", "UPC", "eBay sold", "Shopify"].map(
                  (item) => (
                    <span
                      key={item}
                      className={
                        item === "eBay sold"
                          ? "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-[0.85rem] bg-emerald-600 px-5 text-white shadow-sm"
                          : "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-[0.85rem] px-3"
                      }
                    >
                      {item}
                    </span>
                  ),
                )}
              </div>
            </div>

            <div className="p-4">
              <div className="mb-3 flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                <span className="flex items-center gap-2">
                  <RotateCcw size={13} />
                  Pick up where you left off
                </span>
                <span className="hidden normal-case tracking-normal sm:inline">
                  Ctrl+Shift+Z reopens last tab
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <MockTab
                  title="eBay solds - PS5 Slim Disc"
                  url="ebay.com"
                  time="58s"
                />
                <MockTab
                  title="Shopify product draft"
                  url="admin.shopify.com"
                  time="2m"
                />
                <MockTab
                  title="UPC 711719573364 lookup"
                  url="barcodelookup.com"
                  time="2h"
                />
                <MockTab
                  title="PriceCharting: PlayStation 5"
                  url="pricecharting.com"
                  time="3h"
                />
              </div>

              <div className="mt-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Earlier today
                </div>
                <div className="space-y-1">
                  <RecentRow
                    title="Volt - Chrome scanner session"
                    url="volt-scanner.vercel.app/session"
                    active
                  />
                  <RecentRow
                    title="Browse PlayStation sold listings"
                    url="ebay.com/sch/i.html?_sop=13"
                  />
                  <RecentRow
                    title="Shopify inventory search"
                    url="admin.shopify.com/store/products"
                  />
                </div>
              </div>
            </div>
          </section>

          <div className="mt-4 flex justify-center gap-3">
            <ToolPill icon={Calculator} label="Offer Calculator" />
            <ToolPill icon={Smartphone} label="Mobile Scanner" />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <MockColumn
              title="Quick links"
              icon={ExternalLink}
              items={[
                ["IMEI Info", "AT&T Unlock Portal"],
                ["Market Pricing", "Gazelle Trade-In"],
                ["Market Pricing", "GameStop Trade-In"],
              ]}
            />
            <MockColumn
              title="Bookmarks"
              icon={Bookmark}
              items={[
                ["Chrome", "Developer Dashboard"],
                ["Tools", "Google Sheets"],
                ["Store", "Shopify Admin"],
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileNewTabDemo() {
  return (
    <div className="overflow-hidden rounded-[1.2rem] border border-zinc-200 bg-white shadow-xl shadow-zinc-950/10">
      <div className="relative overflow-hidden bg-gradient-to-b from-emerald-50 via-white to-zinc-50 p-4">
        <div className="absolute left-1/2 top-0 size-64 -translate-x-1/2 rounded-full bg-emerald-200/55 blur-3xl" />
        <div className="relative">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <img src="/favicon.svg" alt="" className="size-7" />
              <span className="text-sm font-semibold text-zinc-950">Volt</span>
            </div>
            <PairingStatus status="paired" />
          </div>

          <div className="mt-6 text-center">
            <p className="text-xs font-semibold text-zinc-600">Good evening</p>
            <div className="mt-1 flex items-baseline justify-center gap-1.5 text-zinc-950">
              <span className="text-5xl font-bold leading-none">7:21</span>
              <span className="text-base font-semibold">PM</span>
            </div>
            <p className="mt-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-zinc-400">
              Sunday, June 21
            </p>
          </div>

          <section className="mt-6 overflow-hidden rounded-[1rem] border border-zinc-200 bg-white/90 shadow-lg shadow-zinc-950/10 backdrop-blur">
            <div className="border-b border-zinc-200 p-3">
              <div className="flex items-center gap-2 rounded-[0.85rem] bg-zinc-100 px-3 py-2 text-sm text-zinc-500">
                <Search size={16} />
                <span className="min-w-0 truncate">Search resale prices</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-[0.8rem] bg-zinc-100 p-1 text-[0.68rem] font-semibold text-zinc-600">
                <span className="flex h-7 items-center justify-center rounded-[0.65rem]">
                  Google
                </span>
                <span className="flex h-7 items-center justify-center rounded-[0.65rem] bg-emerald-600 text-white shadow-sm">
                  eBay sold
                </span>
                <span className="flex h-7 items-center justify-center rounded-[0.65rem]">
                  Shopify
                </span>
              </div>
            </div>

            <div className="p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-zinc-400">
                <RotateCcw size={12} />
                Pick up where you left off
              </div>
              <div className="space-y-2">
                <MockTab
                  title="eBay solds - PS5 Slim Disc"
                  url="ebay.com"
                  time="58s"
                />
                <MockTab
                  title="Shopify product draft"
                  url="admin.shopify.com"
                  time="2m"
                />
                <MockTab
                  title="PriceCharting: PlayStation 5"
                  url="pricecharting.com"
                  time="3h"
                />
              </div>
            </div>
          </section>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <MobileToolButton icon={Calculator} label="Offer calculator" />
            <MobileToolButton icon={Smartphone} label="Mobile scanner" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileToolButton({
  icon: Icon,
  label,
}: {
  icon: typeof Search;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-1.5 rounded-[0.8rem] border border-zinc-200 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-700 shadow-sm">
      <Icon size={14} className="shrink-0 text-emerald-600" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

function MockTab({
  time,
  title,
  url,
}: {
  time: string;
  title: string;
  url: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[0.95rem] border border-zinc-200 bg-white p-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-[0.65rem] bg-zinc-100 text-zinc-500">
        <GlobeIcon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-950">
          {title}
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">{url}</div>
      </div>
      <span className="shrink-0 text-xs text-zinc-400">{time}</span>
    </div>
  );
}

function RecentRow({
  active,
  title,
  url,
}: {
  active?: boolean;
  title: string;
  url: string;
}) {
  return (
    <div
      className={
        active
          ? "flex items-center gap-3 rounded-[0.95rem] bg-emerald-50 px-3 py-2.5"
          : "flex items-center gap-3 rounded-[0.95rem] px-3 py-2.5"
      }
    >
      <div className="grid size-6 shrink-0 place-items-center text-zinc-400">
        <GlobeIcon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-950">
          {title}
        </div>
        <div className="truncate text-xs text-zinc-500">{url}</div>
      </div>
      <span className="text-xs text-zinc-400">3h</span>
    </div>
  );
}

function ToolPill({
  icon: Icon,
  label,
}: {
  icon: typeof Search;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm">
      <Icon size={16} className="text-emerald-600" />
      {label}
    </div>
  );
}

function GlobeIcon() {
  return <Chrome size={15} />;
}

function MockColumn({
  icon: Icon,
  items,
  title,
}: {
  icon: typeof Search;
  items: Array<[string, string]>;
  title: string;
}) {
  return (
    <section className="rounded-[1.35rem] border border-zinc-200 bg-white/85 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {title}
        </h4>
        <Icon size={14} className="text-zinc-400" />
      </div>
      <div className="space-y-2">
        {items.map(([category, item]) => (
          <div
            key={`${category}-${item}`}
            className="rounded-[0.85rem] px-2 py-1.5 hover:bg-zinc-50"
          >
            <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-zinc-400">
              {category}
            </div>
            <div className="truncate text-sm font-medium text-zinc-700">
              {item}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MobileFeatureShot({ src, title }: { src: string; title: string }) {
  return (
    <article className="w-[18rem] shrink-0 overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.04] shadow-lg shadow-black/20">
      <img
        src={src}
        alt={`${title} screenshot`}
        className="w-full object-contain"
      />
    </article>
  );
}
