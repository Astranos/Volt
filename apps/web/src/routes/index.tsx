import { createFileRoute } from "@tanstack/react-router";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowRight,
  BellRing,
  Chrome,
  DatabaseZap,
  FileCheck2,
  LockKeyhole,
  RadioTower,
  ScanBarcode,
  ShieldCheck,
  Smartphone,
  Store,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Home,
});

const supportLinks = [
  ["Support", "https://github.com/JuanQuenga/Volt/issues"],
  ["Privacy", "#privacy"],
  ["Scanner status", "#scanner"],
];

const appStoreItems = [
  "Camera access is used for barcode, text, and product photo capture.",
  "Microphone and speech recognition are used only for hold-to-speak dictation.",
  "Captured text, barcode, dictation, and photo payloads move over WebRTC after pairing.",
  "Convex stores short-lived signaling records only: tokens, offers, answers, pairings, and reconnect requests.",
];

const platformItems = [
  {
    icon: DatabaseZap,
    title: "Convex signaling",
    body: "Join tokens, attempts, durable pairings, and reconnect windows are stored in Convex with scheduled expiry cleanup.",
  },
  {
    icon: RadioTower,
    title: "WebRTC after pairing",
    body: "The phone and Chrome extension exchange scanner payloads directly after the short signaling handshake finishes.",
  },
  {
    icon: BellRing,
    title: "Push-first reconnect",
    body: "Web Push can wake the browser extension, while background fallback polling stays low-frequency outside active reconnect windows.",
  },
];

function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center gap-2" aria-label="Volt home">
            <img src="/assets/volt.webp" alt="" className="size-8 rounded-md object-cover" />
            <span className="text-sm font-semibold">Volt</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm text-zinc-600 md:flex" aria-label="Primary">
            <a className="hover:text-zinc-950" href="#scanner">Scanner</a>
            <a className="hover:text-zinc-950" href="#app-store">App Store</a>
            <a className="hover:text-zinc-950" href="#privacy">Privacy</a>
          </nav>
          <Popover.Root>
            <Popover.Trigger className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm hover:border-zinc-900">
              Support
              <ArrowRight size={14} />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner sideOffset={10}>
                <Popover.Popup className="z-50 w-64 rounded-md border border-zinc-200 bg-white p-2 text-sm shadow-xl shadow-zinc-950/10 outline-none">
                  <Popover.Arrow className="fill-white" />
                  <Popover.Title className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    App links
                  </Popover.Title>
                  {supportLinks.map(([label, href]) => (
                    <a key={label} href={href} className="flex items-center justify-between rounded px-3 py-2 text-zinc-800 hover:bg-zinc-100">
                      {label}
                      <ArrowRight size={14} />
                    </a>
                  ))}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </header>

      <section id="top" className="border-b border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_0.9fr] lg:px-8 lg:py-20">
          <div className="flex min-h-[66vh] flex-col justify-center">
            <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
              <Store size={14} />
              App Store support surface for Volt Scanner
            </div>
            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] text-zinc-950 sm:text-6xl lg:text-7xl">
              Volt
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600 sm:text-xl">
              A mobile scanner app and Chrome extension for fast product capture in desktop inventory workflows.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#app-store" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800">
                App information
                <FileCheck2 size={16} />
              </a>
              <a href="#scanner" className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-800 hover:border-zinc-950">
                Scanner architecture
                <ScanBarcode size={16} />
              </a>
            </div>
          </div>
          <HeroPanel />
        </div>
      </section>

      <section id="scanner" className="border-b border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
            <div>
              <p className="text-sm font-semibold text-zinc-500">Scanner</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-zinc-950 sm:text-4xl">
                Pair once, then keep scanner payloads off the server.
              </h2>
            </div>
            <div className="grid gap-px overflow-hidden border border-zinc-200 bg-zinc-200 md:grid-cols-3">
              {platformItems.map((item) => (
                <article key={item.title} className="min-h-72 bg-white p-6">
                  <item.icon size={24} className="text-zinc-950" />
                  <h3 className="mt-8 text-lg font-semibold text-zinc-950">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-zinc-600">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="app-store" className="border-b border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-24">
          <div>
            <p className="text-sm font-semibold text-zinc-500">App Store</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-zinc-950 sm:text-4xl">
              Required review details in one durable web destination.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-600">
              This Vercel deployment is now reserved for product, support, privacy, and app-review information. Scanner signaling runs on Convex.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden border border-zinc-200 bg-zinc-200">
            {appStoreItems.map((item) => (
              <div key={item} className="flex gap-4 bg-white p-5">
                <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={19} />
                <p className="text-sm leading-6 text-zinc-700">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="bg-zinc-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1fr] lg:px-8 lg:py-24">
          <div>
            <p className="text-sm font-semibold text-zinc-400">Privacy</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
              Signaling state is separate from scanner content.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-zinc-300">
            <p>
              Convex stores pairing and reconnect metadata needed to establish WebRTC. OCR text, barcode values, dictation text, and photo bytes are not written to Convex by the production scanner flow.
            </p>
            <p>
              Durable pairings use a rolling 90-day expiry. Join tokens last about two minutes, join attempts about 32 seconds, and reconnect requests about 95 seconds.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function HeroPanel() {
  return (
    <div className="flex items-center">
      <div className="w-full overflow-hidden border border-zinc-200 bg-zinc-950 text-white shadow-2xl shadow-zinc-950/15">
        <div className="flex items-center justify-between border-b border-white/15 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Chrome size={16} />
            Chrome extension
          </div>
          <span className="text-xs text-emerald-400">paired</span>
        </div>
        <div className="grid gap-px bg-white/15 sm:grid-cols-[0.9fr_1.1fr]">
          <div className="bg-zinc-950 p-6">
            <div className="mx-auto max-w-52 rounded-[2rem] border border-white/15 bg-zinc-900 p-3">
              <div className="relative aspect-[9/16] overflow-hidden rounded-[1.4rem] border border-white/15 bg-zinc-950">
                <img src="/assets/volt.webp" alt="Volt app icon" className="absolute left-1/2 top-7 size-16 -translate-x-1/2 rounded-2xl object-cover" />
                <div className="absolute inset-x-7 bottom-16 space-y-3">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <Smartphone size={14} />
                    iPhone camera
                  </div>
                  <div className="h-2 bg-white" />
                  <div className="grid grid-cols-8 gap-1">
                    {Array.from({ length: 32 }).map((_, index) => (
                      <span key={index} className={`h-10 bg-white ${index % 3 === 0 ? "opacity-90" : "opacity-40"}`} />
                    ))}
                  </div>
                  <div className="scan-beam h-0.5 bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.95)]" />
                </div>
              </div>
            </div>
          </div>
          <div className="grid content-between gap-4 bg-white p-6 text-zinc-950">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Zap size={17} />
                Scanner event
              </div>
              <div className="mt-6 grid gap-3 font-mono text-xs">
                <Metric label="transport" value="WebRTC" />
                <Metric label="signal" value="Convex" />
                <Metric label="payload store" value="none" />
              </div>
            </div>
            <div className="border border-zinc-200 bg-zinc-50 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <LockKeyhole size={16} />
                Data boundary
              </div>
              <p className="text-sm leading-6 text-zinc-600">
                Server state is limited to the rendezvous records needed to connect the devices.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-zinc-200 pb-2 last:border-b-0">
      <span className="text-zinc-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}
