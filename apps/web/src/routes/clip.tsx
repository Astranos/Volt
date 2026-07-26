import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Chrome, Smartphone } from "lucide-react";

import { mobileAppDownloadUrl, SiteFooter, SiteHeader } from "../site-chrome";

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

function ClipLandingPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <SiteHeader />
      <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6 lg:py-28">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-green-100 text-green-700">
          <Smartphone size={32} aria-hidden="true" />
        </div>

        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-green-700">
          Volt App Clip
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Scan into your Chrome workspace
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg">
          Open a Volt new tab in Chrome, select the phone button, and scan its QR code with your iPhone.
          The App Clip joins that signed-in workspace and lets you choose any online computer as the typing target.
        </p>

        <div className="mt-9 grid w-full gap-4 text-left sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <Chrome className="text-green-700" aria-hidden="true" />
            <h2 className="mt-4 font-semibold">Start in Chrome</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              The short-lived QR carries the secure workspace grant needed by the App Clip.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <Smartphone className="text-green-700" aria-hidden="true" />
            <h2 className="mt-4 font-semibold">No install required</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Use Text, Barcode, Photos, and Upload without the installed app&apos;s Volt Pro gate.
            </p>
          </div>
        </div>

        <a
          href={mobileAppDownloadUrl}
          className="mt-9 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          Get the full Volt app
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </main>
      <SiteFooter />
    </div>
  );
}
