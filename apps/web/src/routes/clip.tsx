import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Chrome } from "lucide-react";

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
  "Open a new tab in Chrome",
  "Click the phone button to show the QR code",
  "Scan it with your iPhone’s Camera, then tap Open",
];

function ClipLandingPage() {
  return (
    <div className="min-h-svh bg-[#f2f2f7] text-[17px] leading-snug text-black dark:bg-black dark:text-white">
      <main className="mx-auto w-full max-w-[480px] px-4 pt-7 pb-8">
        <section className="grid grid-cols-[96px_1fr] items-center gap-4 px-1 pt-2" aria-label="Volt">
          <img src="/app-icon-512.png" alt="" className="size-24 rounded-[22px]" />
          <div>
            <h1 className="text-[22px] font-bold">Volt</h1>
            <p className="mt-0.5 mb-2.5 text-[15px] text-black/60 dark:text-white/60">Scan text and barcodes into Chrome</p>
            <a
              href={mobileAppDownloadUrl}
              className="inline-block rounded-full bg-[#1a7f37] px-[18px] py-1.5 text-[15px] font-bold text-white"
            >
              Get the app
            </a>
          </div>
        </section>

        <h2 className="mx-1 mt-9 mb-2 text-[28px] leading-tight font-bold">Open the App Clip from Chrome</h2>
        <p className="mx-1 text-black/60 dark:text-white/60">
          The App Clip joins your workspace through the QR code on Volt’s Chrome new tab, so that’s where it opens from.
        </p>

        <p className="mx-5 mt-7 mb-2 text-[13px] text-black/60 dark:text-white/60">On your computer</p>
        <ol className="overflow-hidden rounded-xl bg-white dark:bg-[#1c1c1e]">
          {steps.map((step, index) => (
            <li key={step} className="flex min-h-[52px] items-center gap-3.5 pl-4">
              <span className="grid size-[26px] flex-none place-items-center rounded-full bg-[#1a7f37] text-sm font-bold text-white">
                {index + 1}
              </span>
              <span className={`flex-1 py-3 pr-4 ${index > 0 ? "border-t-[0.5px] border-black/30 dark:border-white/20" : ""}`}>
                {step}
              </span>
            </li>
          ))}
        </ol>
        <p className="mx-5 mt-2 text-[13px] text-black/60 dark:text-white/60">
          Nothing to install. The App Clip opens straight to the camera.
        </p>

        <p className="mx-5 mt-7 mb-2 text-[13px] text-black/60 dark:text-white/60">Don’t have Volt in Chrome?</p>
        <a
          href={chromeExtensionDownloadUrl}
          className="flex min-h-[52px] items-center gap-3.5 rounded-xl bg-white px-4 active:bg-black/10 dark:bg-[#1c1c1e]"
        >
          <span className="grid size-[29px] place-items-center rounded-[7px] bg-[#1a73e8] text-white">
            <Chrome size={17} aria-hidden="true" />
          </span>
          <span className="flex-1">Add Volt to Chrome</span>
          <ChevronRight size={18} className="text-black/40 dark:text-white/40" aria-hidden="true" />
        </a>

        <footer className="mx-5 mt-9 flex gap-5 text-[13px] text-[#248a3d] dark:text-[#30d158]">
          <a href="/privacy">Privacy</a>
          <a href={supportUrl}>Support</a>
        </footer>
      </main>
    </div>
  );
}
