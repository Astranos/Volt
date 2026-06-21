import { createFileRoute } from "@tanstack/react-router";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Chrome,
  ClipboardCheck,
  DatabaseZap,
  Keyboard,
  LockKeyhole,
  PackageCheck,
  RadioTower,
  ScanBarcode,
  SearchCheck,
  ShieldCheck,
  Smartphone,
  TimerReset,
  Zap,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Home,
});

const supportLinks = [
  ["Support", "https://github.com/JuanQuenga/Volt/issues"],
  ["Privacy", "#privacy"],
  ["Workflow", "#workflow"],
];

const proofPoints = [
  { value: "Phone camera", label: "captures barcodes, labels, and product photos" },
  { value: "Chrome extension", label: "delivers scans into desktop listing workflows" },
  { value: "WebRTC path", label: "moves scanner payloads after pairing" },
];

const captureExamples = [
  {
    title: "Barcode capture",
    body: "Detect package barcodes in the camera view and send the value straight to the paired browser session.",
    image: "/assets/app-screenshots/barcode-detected.webp",
    alt: "Volt mobile scanner detecting a barcode on product packaging",
  },
  {
    title: "Text extraction",
    body: "Review tiny model numbers, serials, and label text before sending extracted content to the desktop.",
    image: "/assets/app-screenshots/text-extracted.webp",
    alt: "Volt mobile scanner extracting text from a close-up product label",
  },
  {
    title: "Capture history",
    body: "Keep recent barcodes, OCR text, photos, and delivery states visible during a scanning session.",
    image: "/assets/app-screenshots/capture-results.webp",
    alt: "Volt mobile scanner showing recent capture results",
  },
];

const problemItems = [
  {
    icon: TimerReset,
    title: "Manual entry slows every listing",
    body: "Typing identifiers, copying label text, and moving photos from phone to computer turns simple intake into repetitive admin work.",
  },
  {
    icon: Boxes,
    title: "Desktop tools still need mobile capture",
    body: "Sellers work in browser tabs, but the best scanner and camera are already in their pocket.",
  },
  {
    icon: ClipboardCheck,
    title: "Context switching creates mistakes",
    body: "Barcodes, titles, notes, and photos lose accuracy when they bounce through messages, cloud drives, and clipboards.",
  },
];

const capabilityItems = [
  {
    icon: ScanBarcode,
    title: "Scan product identifiers",
    body: "Use the phone camera for UPCs, model numbers, serials, and other inventory labels while staying focused on the desktop page.",
  },
  {
    icon: SearchCheck,
    title: "Capture useful text",
    body: "Turn label text and spoken notes into structured input for research, cataloging, and listing prep.",
  },
  {
    icon: PackageCheck,
    title: "Send product photos",
    body: "Move reference photos from the mobile scanner to the browser workflow without a separate file-transfer step.",
  },
  {
    icon: Keyboard,
    title: "Insert where work happens",
    body: "The extension receives captures beside marketplace, inventory, and research tabs so the next action can happen immediately.",
  },
];

const platformItems = [
  {
    icon: DatabaseZap,
    title: "Short-lived signaling",
    body: "Convex coordinates join tokens, attempts, pairings, and reconnect windows so devices can find each other reliably.",
  },
  {
    icon: RadioTower,
    title: "Direct scanner payloads",
    body: "After pairing, scan results and photos move through WebRTC instead of being written into the signaling backend.",
  },
  {
    icon: ShieldCheck,
    title: "Clear data boundary",
    body: "Pairing metadata is separate from barcode values, OCR text, dictation, and photo bytes in the production scanner flow.",
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
            <a className="hover:text-zinc-950" href="#problems">Problems</a>
            <a className="hover:text-zinc-950" href="#workflow">Workflow</a>
            <a className="hover:text-zinc-950" href="#examples">Examples</a>
            <a className="hover:text-zinc-950" href="#capabilities">Capabilities</a>
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
              <BadgeCheck size={14} />
              Built for product intake, resale, and desktop inventory work
            </div>
            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] text-zinc-950 sm:text-6xl lg:text-7xl">
              Volt turns your phone into the scanner your browser is missing.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600 sm:text-xl">
              Pair the mobile app with the Chrome extension to capture barcodes, label text, spoken notes, and product photos without breaking your desktop workflow.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#workflow" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800">
                See the workflow
                <ArrowRight size={16} />
              </a>
              <a href="#capabilities" className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-800 hover:border-zinc-950">
                What Volt captures
                <ScanBarcode size={16} />
              </a>
            </div>
            <div className="mt-12 grid gap-px overflow-hidden border border-zinc-200 bg-zinc-200 sm:grid-cols-3">
              {proofPoints.map((item) => (
                <div key={item.value} className="bg-white p-4">
                  <p className="text-sm font-semibold text-zinc-950">{item.value}</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-600">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
          <HeroPanel />
        </div>
      </section>

      <section id="problems" className="border-b border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
            <div>
              <p className="text-sm font-semibold text-zinc-500">Problems Volt Solves</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-zinc-950 sm:text-4xl">
                Product intake should not feel like paperwork.
              </h2>
              <p className="mt-5 text-base leading-7 text-zinc-600">
                Volt is aimed at the gap between physical inventory and browser-based tools: the moment where sellers, operators, and collectors have the item in hand but the work lives on a desktop screen.
              </p>
            </div>
            <div className="grid gap-px overflow-hidden border border-zinc-200 bg-zinc-200 md:grid-cols-3">
              {problemItems.map((item) => (
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

      <section id="workflow" className="border-b border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-24">
          <div>
            <p className="text-sm font-semibold text-zinc-500">Workflow</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-zinc-950 sm:text-4xl">
              Mobile capture, desktop action.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-600">
              Volt keeps capture on the device that is best at it and sends the result to the browser surface where pricing, research, listing, and cataloging already happen.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden border border-zinc-200 bg-zinc-200 md:grid-cols-3">
            <WorkflowStep number="01" title="Pair" body="Connect the mobile app and Chrome extension for a desktop session." />
            <WorkflowStep number="02" title="Capture" body="Scan a code, read a label, dictate a note, or send a product photo." />
            <WorkflowStep number="03" title="Act" body="Use the capture in the browser without detouring through manual transfer." />
          </div>
        </div>
      </section>

      <section id="capabilities" className="border-b border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mb-10 max-w-2xl">
            <p className="text-sm font-semibold text-zinc-500">Capabilities</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight text-zinc-950 sm:text-4xl">
              Capture the product details that usually slow down listing.
            </h2>
          </div>
          <div className="grid gap-px overflow-hidden border border-zinc-200 bg-zinc-200 sm:grid-cols-2 lg:grid-cols-4">
            {capabilityItems.map((item) => (
              <article key={item.title} className="min-h-64 bg-white p-6">
                <item.icon size={24} className="text-zinc-950" />
                <h3 className="mt-8 text-lg font-semibold text-zinc-950">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="examples" className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mb-10 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-semibold text-zinc-500">Capture Examples</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-zinc-950 sm:text-4xl">
                Real product details, ready for the next browser step.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-zinc-600 lg:pt-8">
              The generated iPhone screenshots show Volt in the moments that matter: detecting product identifiers, reviewing extracted text, and keeping capture results ready for the next desktop action.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden border border-zinc-200 bg-zinc-200 lg:grid-cols-3">
            {captureExamples.map((item) => (
              <article key={item.title} className="grid bg-white">
                <div className="flex min-h-[34rem] items-end justify-center overflow-hidden bg-zinc-100 px-8 pt-8">
                  <img src={item.image} alt={item.alt} className="max-h-[32rem] w-auto max-w-full object-contain" loading="lazy" />
                </div>
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-zinc-950">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-zinc-600">{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="bg-zinc-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1fr] lg:px-8 lg:py-24">
          <div>
            <p className="text-sm font-semibold text-zinc-400">Privacy</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
              Fast capture with a tight data boundary.
            </h2>
          </div>
          <div className="grid gap-px overflow-hidden border border-white/15 bg-white/15 md:grid-cols-3">
            {platformItems.map((item) => (
              <article key={item.title} className="bg-zinc-950 p-6">
                <item.icon size={23} className="text-emerald-400" />
                <h3 className="mt-8 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-300">{item.body}</p>
              </article>
            ))}
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
            <div className="mx-auto max-w-64">
              <div className="mb-4 flex items-center justify-between rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs backdrop-blur">
                <div className="flex items-center gap-2 text-zinc-200">
                  <Smartphone size={14} />
                  iPhone camera
                </div>
                <span className="text-emerald-300">live</span>
              </div>
              <img src="/assets/app-screenshots/barcode-detected.webp" alt="Volt barcode scanner on iPhone" className="mx-auto w-full object-contain drop-shadow-2xl" />
            </div>
          </div>
          <div className="grid content-between gap-4 bg-white p-6 text-zinc-950">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Zap size={17} />
                Product capture
              </div>
              <div className="mt-6 grid gap-3 font-mono text-xs">
                <Metric label="barcode" value="ready" />
                <Metric label="label text" value="captured" />
                <Metric label="photo" value="sent" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <img src="/assets/app-screenshots/text-extracted.webp" alt="Volt text extraction screen" className="h-28 w-full object-contain" />
              <img src="/assets/app-screenshots/photo-viewfinder.webp" alt="Volt photo capture screen" className="h-28 w-full object-contain" />
              <img src="/assets/app-screenshots/upload-batches.webp" alt="Volt upload batches screen" className="h-28 w-full object-contain" />
            </div>
            <div className="border border-zinc-200 bg-zinc-50 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <LockKeyhole size={16} />
                Desktop handoff
              </div>
              <p className="text-sm leading-6 text-zinc-600">
                Capture physical product details on mobile and keep the next task in the browser.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <article className="bg-white p-6">
      <div className="font-mono text-xs text-zinc-500">{number}</div>
      <h3 className="mt-10 text-lg font-semibold text-zinc-950">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-zinc-600">{body}</p>
    </article>
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
