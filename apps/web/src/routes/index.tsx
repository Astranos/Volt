import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Barcode,
  Blocks,
  Camera,
  Check,
  Chrome,
  ClipboardCheck,
  Cloud,
  LockKeyhole,
  RadioTower,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Home,
});

const workflowSteps = [
  {
    icon: Chrome,
    title: "Extension starts the session",
    body: "Open the Volt sidepanel from the page where the data needs to land.",
  },
  {
    icon: Smartphone,
    title: "Phone pairs instantly",
    body: "Scan the pairing code and use the phone camera as the dedicated capture device.",
  },
  {
    icon: ClipboardCheck,
    title: "Scans arrive at the cursor",
    body: "Barcodes and reviewed text move over the paired channel into the active desktop field.",
  },
];

const featureGroups = [
  {
    label: "Capture",
    title: "Phone-grade scanning without leaving the browser.",
    body: "Volt keeps the extension focused on desktop context and lets the mobile camera handle UPC, EAN, QR, and Code-128 capture.",
    items: ["Camera-first mobile scanner", "Scan cooldown protection", "Torch control when supported"],
  },
  {
    label: "Transfer",
    title: "A direct session between the device in your hand and the tab at work.",
    body: "WebRTC carries scan events and capture results after a short pairing handshake, with a hosted signaling fallback for active sessions.",
    items: ["Paired scanner sessions", "Local answer-code flow", "Hosted signaling route"],
  },
  {
    label: "Workflow",
    title: "Built for inventory, resale, and repetitive product entry.",
    body: "The extension sidepanel organizes scanner history, photo capture, POS helpers, and offer tools around the work already happening in the browser.",
    items: ["Sidepanel scanner history", "Drag-ready mobile photos", "POS inventory helpers"],
  },
];

const stats = [
  ["WebRTC", "paired transport"],
  ["4+", "barcode formats"],
  ["0", "desktop camera setup"],
];

function Home() {
  return (
    <main className="min-h-screen bg-white text-volt-ink">
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center gap-2" aria-label="Volt home">
            <span className="grid size-7 place-items-center rounded-sm bg-black text-white">
              <Zap size={16} strokeWidth={2.4} />
            </span>
            <span className="text-sm font-semibold">Volt</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm text-neutral-600 md:flex" aria-label="Primary">
            <a className="hover:text-black" href="#product">
              Product
            </a>
            <a className="hover:text-black" href="#workflow">
              Workflow
            </a>
            <a className="hover:text-black" href="#platform">
              Platform
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <a
              href="/scan/local"
              className="hidden h-9 items-center justify-center rounded-md border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:border-neutral-900 hover:text-black sm:flex"
            >
              Scanner
            </a>
            <a
              href="#start"
              className="flex h-9 items-center justify-center gap-2 rounded-md bg-black px-3 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Get started
              <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </header>

      <section id="top" className="landing-grid border-b border-neutral-200">
        <div className="mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl grid-rows-[1fr_auto] px-4 sm:px-6 lg:px-8">
          <div className="grid items-center gap-10 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
            <div className="max-w-4xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm">
                <RadioTower size={14} />
                Browser extension. Mobile scanner. One paired session.
              </div>
              <h1 className="max-w-5xl text-5xl font-semibold leading-[1.02] text-black sm:text-6xl lg:text-7xl">
                Product capture infrastructure for desktop operators.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-600 sm:text-xl">
                Volt turns the phone already on your desk into the scanner, camera, and capture assistant for the browser workflows that still happen on desktop.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#start"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-black px-5 text-sm font-semibold text-white hover:bg-neutral-800"
                >
                  Start with Volt
                  <ArrowRight size={16} />
                </a>
                <a
                  href="#product"
                  className="inline-flex h-11 items-center justify-center rounded-md border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-800 hover:border-neutral-900"
                >
                  Explore product
                </a>
              </div>
            </div>

            <HeroVisual />
          </div>

          <div className="grid border-x border-t border-neutral-200 bg-white md:grid-cols-3">
            {stats.map(([value, label]) => (
              <div key={label} className="border-b border-neutral-200 p-5 md:border-b-0 md:border-r md:last:border-r-0">
                <p className="text-2xl font-semibold text-black">{value}</p>
                <p className="mt-1 text-sm text-neutral-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="product" className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-semibold text-neutral-500">Product</p>
              <h2 className="mt-3 max-w-xl text-3xl font-semibold leading-tight text-black sm:text-4xl">
                The scanner stack for browser-native inventory work.
              </h2>
            </div>
            <div className="grid gap-px overflow-hidden border border-neutral-200 bg-neutral-200 md:grid-cols-3">
              {workflowSteps.map((step) => (
                <article key={step.title} className="min-h-64 bg-white p-6">
                  <step.icon size={24} className="text-black" />
                  <h3 className="mt-8 text-lg font-semibold text-black">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-neutral-600">{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="bg-black text-white">
        <div className="dark-grid border-b border-white/15">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <div>
                <p className="text-sm font-semibold text-neutral-400">Workflow</p>
                <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
                  Scan, review, and transfer without breaking operator rhythm.
                </h2>
              </div>
              <p className="max-w-2xl text-lg leading-8 text-neutral-300">
                Volt is not a generic camera page. It is a coordinated browser extension, mobile scanner route, and protocol package designed around fast product data movement.
              </p>
            </div>

            <div className="mt-12 grid gap-px overflow-hidden border border-white/15 bg-white/15 lg:grid-cols-3">
              {featureGroups.map((group) => (
                <article key={group.label} className="min-h-[29rem] bg-black p-6">
                  <div className="flex items-center justify-between border-b border-white/15 pb-5">
                    <span className="text-sm font-medium text-neutral-300">{group.label}</span>
                    <Blocks size={18} className="text-neutral-500" />
                  </div>
                  <h3 className="mt-7 text-2xl font-semibold leading-tight">{group.title}</h3>
                  <p className="mt-4 text-sm leading-6 text-neutral-400">{group.body}</p>
                  <ul className="mt-8 space-y-3">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-center gap-3 text-sm text-neutral-200">
                        <span className="grid size-5 place-items-center rounded-full border border-white/20">
                          <Check size={13} />
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="border-b border-neutral-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-24">
          <div>
            <p className="text-sm font-semibold text-neutral-500">Platform</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-black sm:text-4xl">
              Built as a small system, not a throwaway utility.
            </h2>
          </div>
          <div className="grid gap-px overflow-hidden border border-neutral-200 bg-neutral-200 sm:grid-cols-2">
            <PlatformCard icon={LockKeyhole} title="Paired by design" body="Session ids, pairing payloads, and answer codes keep the desktop and phone on the same capture lane." />
            <PlatformCard icon={Cloud} title="Deployable web surface" body="The scanner route and signaling API live beside the landing page, ready for Vercel-hosted web deployment." />
            <PlatformCard icon={ShieldCheck} title="Protocol package" body="Shared scanner constants, ids, validation, and control messages keep extension and mobile behavior aligned." />
            <PlatformCard icon={Zap} title="Operator speed" body="Cooldowns, scan counts, vibration feedback, and cursor insertion are tuned for repeated product entry." />
          </div>
        </div>
      </section>

      <section id="start" className="landing-grid bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid overflow-hidden border border-neutral-200 bg-white lg:grid-cols-[1fr_0.9fr]">
            <div className="p-7 sm:p-10 lg:p-12">
              <p className="text-sm font-semibold text-neutral-500">Start building with Volt</p>
              <h2 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight text-black sm:text-5xl">
                Open the extension sidepanel and pair your phone.
              </h2>
              <p className="mt-5 max-w-xl text-base leading-7 text-neutral-600">
                The web route is ready for pairing, while the extension owns desktop insertion and capture history.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="/scan/local"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-black px-5 text-sm font-semibold text-white hover:bg-neutral-800"
                >
                  Open scanner route
                  <ScanLine size={16} />
                </a>
                <a
                  href="https://github.com/JuanQuenga/Volt"
                  className="inline-flex h-11 items-center justify-center rounded-md border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-800 hover:border-neutral-900"
                >
                  View repository
                </a>
              </div>
            </div>
            <div className="border-t border-neutral-200 bg-neutral-950 p-6 text-white lg:border-l lg:border-t-0">
              <div className="rounded-md border border-white/15 bg-black font-mono text-xs leading-6 text-neutral-300">
                <div className="border-b border-white/15 px-4 py-3 text-neutral-500">workspace</div>
                <div className="space-y-1 p-4">
                  <p><span className="text-volt-green">$</span> pnpm --filter @volt/web dev</p>
                  <p className="text-neutral-500">TanStack Start route server ready</p>
                  <p><span className="text-volt-green">$</span> pnpm --filter @volt/mobile build:ios</p>
                  <p className="text-neutral-500">Volt scanner compiled for iOS</p>
                  <p><span className="text-volt-green">$</span> pnpm --filter @volt/extension build</p>
                  <p className="text-neutral-500">Browser extension package emitted</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div className="absolute -inset-4 border border-neutral-200 bg-white/60" />
      <div className="relative grid gap-px overflow-hidden border border-neutral-200 bg-neutral-200 shadow-2xl shadow-neutral-900/10">
        <div className="bg-black p-4 text-white">
          <div className="mb-4 flex items-center justify-between border-b border-white/15 pb-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Chrome size={16} />
              Volt sidepanel
            </div>
            <div className="rounded-full border border-white/20 px-2 py-1 text-[11px] text-neutral-300">
              Live session
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-[1.5rem] border border-white/15 bg-neutral-950 p-3">
              <div className="relative aspect-[9/16] overflow-hidden rounded-[1.15rem] border border-white/15 bg-neutral-900">
                <div className="absolute inset-x-7 top-10 bottom-10 rounded-lg border border-white/25" />
                <div className="scan-beam absolute left-7 right-7 top-14 h-0.5 bg-volt-green shadow-[0_0_18px_rgba(33,197,93,0.95)]" />
                <div className="absolute inset-x-9 bottom-14 space-y-2">
                  <div className="h-7 rounded-sm bg-white" />
                  <div className="grid grid-cols-8 gap-1">
                    {Array.from({ length: 32 }).map((_, index) => (
                      <span
                        key={index}
                        className={`h-10 bg-white ${index % 3 === 0 ? "opacity-90" : "opacity-45"}`}
                      />
                    ))}
                  </div>
                </div>
                <Camera className="absolute left-1/2 top-5 -translate-x-1/2 text-neutral-500" size={18} />
              </div>
            </div>
            <div className="grid content-between gap-4">
              <div className="rounded-md border border-white/15 bg-white p-4 text-black">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Barcode size={17} />
                  Scan event
                </div>
                <div className="mt-5 grid gap-2 font-mono text-xs">
                  <div className="flex justify-between border-b border-neutral-200 pb-2">
                    <span className="text-neutral-500">format</span>
                    <span>UPC-A</span>
                  </div>
                  <div className="flex justify-between border-b border-neutral-200 pb-2">
                    <span className="text-neutral-500">target</span>
                    <span>active input</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">latency</span>
                    <span>paired</span>
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-white/15 bg-neutral-950 p-4">
                <div className="mb-3 flex items-center justify-between text-xs text-neutral-400">
                  <span>Transfer channel</span>
                  <span className="text-volt-green">connected</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-4/5 rounded-full bg-volt-green" />
                </div>
                <p className="mt-4 text-sm leading-6 text-neutral-300">
                  Mobile camera input lands in the browser workflow through the paired scanner protocol.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof LockKeyhole;
  title: string;
  body: string;
}) {
  return (
    <article className="min-h-60 bg-white p-6">
      <Icon size={23} className="text-black" />
      <h3 className="mt-8 text-xl font-semibold text-black">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-neutral-600">{body}</p>
    </article>
  );
}
