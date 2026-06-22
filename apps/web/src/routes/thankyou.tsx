import { createFileRoute } from "@tanstack/react-router";
import type { ComponentType } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Barcode,
  Chrome,
  ExternalLink,
  LayoutDashboard,
  MousePointer2,
  PanelRight,
  Pin,
  RotateCcw,
  Settings,
  Smartphone,
} from "lucide-react";

export const Route = createFileRoute("/thankyou")({
  component: Install,
});

type Workflow = {
  title: string;
  description: string;
  image?: string;
  icon: ComponentType<{ className?: string }>;
  accent?: "default" | "warning";
};

const workflows: Workflow[] = [
  {
    title: "Volt new tab",
    description:
      "Start resale work from the Volt dashboard with provider search, saved links, and recently closed tabs.",
    icon: LayoutDashboard,
  },
  {
    title: "Right-click research",
    description:
      "Highlight text and send it straight to eBay solds, PriceCharting, UPC lookup, or configured search providers.",
    icon: MousePointer2,
  },
  {
    title: "UPC capture",
    description:
      "Detect UPCs on product pages, copy them quickly, or bring fresh barcode scans in from the paired iPhone app.",
    icon: Barcode,
  },
  {
    title: "eBay sold-listing warning",
    description:
      "Volt shows a small warning on active or completed eBay result pages so pricing work uses sold listings instead of asking prices.",
    icon: AlertTriangle,
    accent: "warning",
  },
];

function Install() {
  return (
    <main className="min-h-screen bg-[#f7f8fa] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <img
              src="/assets/volt.webp"
              alt="Volt"
              className="h-10 w-10 rounded-[0.75rem] border border-slate-200 bg-white"
            />
            <div>
              <p className="text-sm font-semibold leading-5">Volt</p>
              <p className="text-xs text-slate-500">Chrome workflow + iPhone scanner</p>
            </div>
          </div>

          <div className="hidden items-center gap-2 text-sm text-emerald-700 sm:flex">
            <BadgeCheck className="h-4 w-4" />
            Installed
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[1.35rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-start justify-between gap-6">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                Ready to use
              </p>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                Set up the browser side of Volt.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Pin the extension, keep the dashboard, and open the side panel when you want to pair the iPhone scanner for barcode, OCR, dictation, and photo capture.
              </p>
            </div>
            <img
              src="/assets/volt.webp"
              alt=""
              className="hidden h-16 w-16 rounded-[0.95rem] border border-slate-200 bg-white md:block"
            />
          </div>

          <div className="grid gap-3">
            <SetupStep
              icon={Pin}
              title="Pin Volt"
              body="Click Chrome's extensions button, find Volt, then pin it so the toolbar action is always visible."
            />
            <SetupStep
              icon={LayoutDashboard}
              title="Keep the Volt new tab"
              body='If Chrome asks about the new tab page, choose "Keep it" to keep the dashboard enabled.'
            />
            <SetupStep
              icon={PanelRight}
              title="Open the side panel"
              body="Use the toolbar action for iPhone scanner pairing, received photos, tab tools, settings, and workflow helpers."
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <a
              href="chrome://extensions"
              className="inline-flex items-center gap-2 rounded-[0.85rem] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-300 hover:bg-slate-50"
            >
              <Settings className="h-4 w-4 text-slate-500" />
              Manage extensions
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </a>
            <a
              href="chrome://newtab"
              className="inline-flex items-center gap-2 rounded-[0.85rem] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-300 hover:bg-slate-50"
            >
              <LayoutDashboard className="h-4 w-4 text-slate-500" />
              Open new tab
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </a>
          </div>
        </div>

        <div className="rounded-[1.35rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">
                New tab
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                Search, scanner, and session tools work as one flow.
              </h2>
            </div>
            <Chrome className="h-7 w-7 text-emerald-300" />
          </div>

          <div className="overflow-hidden rounded-[0.95rem] border border-white/10 bg-white/[0.04] p-4">
            <div className="rounded-[0.75rem] bg-white p-3 text-slate-950">
              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <img src="/assets/volt.webp" alt="" className="h-5 w-5 rounded-[0.35rem]" />
                  Volt
                </div>
                <LayoutDashboard className="h-4 w-4 text-slate-500" />
              </div>
              <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-2">
                  {["Google", "PriceCharting", "UPC", "eBay", "Shopify"].map((item) => (
                    <div key={item} className="h-8 rounded-[0.65rem] bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
                      {item}
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="h-8 rounded-[0.65rem] bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-700">
                    Quick links
                  </div>
                  <div className="h-8 rounded-[0.65rem] bg-slate-100" />
                  <div className="h-8 rounded-[0.65rem] bg-slate-100" />
                  <div className="h-8 rounded-[0.65rem] bg-slate-100" />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[0.95rem] border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-50">
            The browser surfaces handle research, pricing, and tab recovery while
            the iPhone scanner sends capture results back into the same workflow.
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-8">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Core workflows
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            How the extension and scanner complement each other
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {workflows.map((workflow) => (
            <WorkflowCard key={workflow.title} workflow={workflow} />
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-10 md:grid-cols-3">
        <UtilityCard
          icon={Smartphone}
          title="iPhone scanner"
          body="Pair the iPhone app with the side panel to send barcodes, OCR text, dictation, and photos into the browser workflow."
        />
        <UtilityCard
          icon={RotateCcw}
          title="Tab recovery"
          body="Reopen closed tabs and manage open browser work without leaving the extension surface."
        />
        <UtilityCard
          icon={Settings}
          title="Local settings"
          body="Tune providers, new-tab behavior, scanner settings, and Volt links from the options page."
        />
      </section>
    </main>
  );
}

function SetupStep({
  icon: Icon,
  title,
  body,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3 rounded-[0.95rem] border border-slate-200 bg-slate-50 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.65rem] bg-white text-emerald-700 shadow-sm">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
      </div>
    </div>
  );
}

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  const Icon = workflow.icon;
  return (
    <article className="overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-sm">
      <div
        className={
          workflow.accent === "warning"
            ? "flex h-44 items-center justify-center border-b border-slate-200 bg-amber-50 text-amber-700"
            : "flex h-44 items-center justify-center border-b border-slate-200 bg-emerald-50 text-emerald-700"
        }
      >
        <Icon className="h-10 w-10" />
      </div>
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <div
            className={
              workflow.accent === "warning"
                ? "rounded-[0.65rem] bg-amber-100 p-2 text-amber-700"
                : "rounded-[0.65rem] bg-emerald-100 p-2 text-emerald-700"
            }
          >
            <Icon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-slate-950">{workflow.title}</h3>
        </div>
        <p className="text-sm leading-6 text-slate-600">{workflow.description}</p>
      </div>
    </article>
  );
}

function UtilityCard({
  icon: Icon,
  title,
  body,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-[1.35rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[0.75rem] bg-slate-100 text-slate-700">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </article>
  );
}
