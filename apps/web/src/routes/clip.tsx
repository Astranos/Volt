import { createFileRoute } from "@tanstack/react-router";
import { Chrome, Smartphone } from "lucide-react";

import { chromeExtensionDownloadUrl, mobileAppDownloadUrl, supportUrl } from "../site-chrome";

// Production serves the static apps/web/public/clip.html for /clip; keep this route's copy in sync.
export const Route = createFileRoute("/clip")({
  head: () => ({
    meta: [
      {
        name: "description",
        content: "Open the Volt App Clip and connect it securely to your Chrome workspace.",
      },
      {
        name: "apple-itunes-app",
        content: "app-id=6771770148, app-clip-bundle-id=com.volt.mobile.Clip, app-clip-display=card",
      },
    ],
    title: "Open Volt App Clip",
  }),
  component: ClipLandingPage,
});

const steps = [
  ["Open a Volt new tab in Chrome", "Tap the phone button to show the workspace QR code."],
  ["Point your iPhone Camera at it", "Use the built-in Camera app or Control Center code scanner."],
  ["Tap Open on the App Clip card", "Pick any online computer and start scanning text, barcodes, and photos."],
] as const;

function ClipLandingPage() {
  return (
    <div className="dark-grid flex min-h-svh flex-col bg-volt-ink text-zinc-50">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-5">
        <header className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 font-semibold" aria-label="Volt home">
            <img src="/favicon.svg" alt="" className="size-7" />
            Volt
          </a>
          <span className="rounded-full border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-zinc-400">
            App Clip
          </span>
        </header>

        <main className="flex-1 py-10 lg:py-16">
          <p className="flex items-center gap-2 text-sm font-semibold text-volt-green">
            <span className="size-1.5 rounded-full bg-volt-green" />
            No install needed
          </p>
          <h1 className="mt-3.5 text-4xl font-semibold leading-none tracking-tight sm:text-6xl">
            Scan straight into <span className="text-volt-green">Chrome</span>.
          </h1>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-zinc-400">
            The Volt App Clip turns your iPhone into a scanner for your computer. It opens from a QR code in
            Chrome, so there&rsquo;s nothing to download.
          </p>

          <ol className="mt-7 grid max-w-xl gap-2.5">
            {steps.map(([title, detail], index) => (
              <li
                key={title}
                className="grid grid-cols-[2rem_1fr] gap-3.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5"
              >
                <span className="grid size-8 place-items-center rounded-[10px] bg-zinc-50 text-sm font-bold text-volt-ink">
                  {index + 1}
                </span>
                <div>
                  <strong className="block text-[15px] font-semibold">{title}</strong>
                  <p className="mt-0.5 text-sm leading-normal text-zinc-400">{detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
            <a
              href={mobileAppDownloadUrl}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-volt-green px-5 font-semibold text-volt-ink hover:brightness-110"
            >
              <Smartphone size={18} aria-hidden="true" />
              Get the full app
            </a>
            <a
              href={chromeExtensionDownloadUrl}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] border border-white/20 px-5 font-semibold hover:border-white/40"
            >
              <Chrome size={18} aria-hidden="true" />
              Add Volt to Chrome
            </a>
          </div>
        </main>

        <footer className="flex flex-wrap justify-between gap-x-5 gap-y-1.5 border-t border-white/10 pt-5 text-[13px] text-zinc-500">
          <span>Not affiliated with Volt Resale or Paymore Electronics.</span>
          <nav className="flex gap-5">
            <a href="/privacy" className="hover:text-zinc-50">Privacy</a>
            <a href={supportUrl} className="hover:text-zinc-50">Support</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
