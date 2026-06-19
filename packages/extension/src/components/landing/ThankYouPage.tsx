import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Barcode,
  ExternalLink,
  LayoutDashboard,
  MousePointer2,
  PanelRight,
  Pin,
  RotateCcw,
  Settings,
  Smartphone,
} from "lucide-react";

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
      "Start new browser work from the Volt dashboard, including provider search, saved links, and recently closed tabs.",
    image: "/assets/images/new-tab.png",
    icon: LayoutDashboard,
  },
  {
    title: "Right-click research",
    description:
      "Highlight text and send it straight to eBay solds, PriceCharting, UPC lookup, or configured search providers.",
    image: "/assets/screenshots/quick-actions.png",
    icon: MousePointer2,
  },
  {
    title: "UPC capture",
    description:
      "Detect UPCs on product pages, copy them quickly, and reduce the small manual steps that slow down listing.",
    image: "/assets/screenshots/upc-highlighter.png",
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

export default function ThankYouPage() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    try {
      setVersion(chrome.runtime.getManifest().version);
    } catch {
      setVersion("");
    }
  }, []);

  const openChromeUrl = (href: string) => {
    const url =
      href === "chrome://extensions/?id=__EXTENSION_ID__"
        ? `chrome://extensions/?id=${chrome.runtime.id}`
        : href;
    chrome.tabs.create({ url });
  };

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <img
              src="/assets/icons/logo-128.png"
              alt="Volt"
              className="h-10 w-10 rounded-lg border border-slate-200 bg-white"
            />
            <div>
              <p className="text-sm font-semibold leading-5">Volt</p>
              <p className="text-xs text-slate-500">
                Chrome extension{version ? ` · v${version}` : ""}
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 text-sm text-emerald-700 sm:flex">
            <BadgeCheck className="h-4 w-4" />
            Installed
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-start justify-between gap-6">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                Ready to use
              </p>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                Set up Volt in under a minute.
              </h1>
            </div>
            <img
              src="/assets/icons/logo-128.png"
              alt=""
              className="hidden h-16 w-16 rounded-lg border border-slate-200 bg-white md:block"
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
              body="Use the toolbar action for scanner pairing, photos, tab tools, settings, and workflow helpers."
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                openChromeUrl("chrome://extensions/?id=__EXTENSION_ID__")
              }
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-300 hover:bg-slate-50"
            >
              <Settings className="h-4 w-4 text-slate-500" />
              Manage extension
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </button>
            <button
              type="button"
              onClick={() => openChromeUrl("chrome://newtab")}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-300 hover:bg-slate-50"
            >
              <LayoutDashboard className="h-4 w-4 text-slate-500" />
              Open new tab
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-950 p-6 text-white shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">
                New tab
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                Search and session tools moved into the dashboard.
              </h2>
            </div>
            <LayoutDashboard className="h-7 w-7 text-emerald-300" />
          </div>

          <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
            <img
              src="/assets/images/new-tab.png"
              alt=""
              className="h-64 w-full object-cover object-top"
            />
          </div>

          <div className="mt-5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-50">
            The new tab is now the home for provider search, saved links, and
            fast tab recovery.
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Core workflows
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              What Volt adds to Chrome
            </h2>
          </div>
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
          title="Mobile scanner"
          body="Pair the iPhone app with the side panel to send scans, dictation, and photos into the browser workflow."
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
    <div className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm">
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
  const isWarning = workflow.accent === "warning";

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {workflow.image ? (
        <div className="border-b border-slate-200 bg-slate-100">
          <img
            src={workflow.image}
            alt=""
            className="h-56 w-full object-cover object-top"
          />
        </div>
      ) : (
        <div className="border-b border-amber-200 bg-amber-50 p-5">
          <div className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              Active listing warning
            </div>
            <p className="text-sm leading-6 text-amber-900">
              Active listings are asking prices, not market comps. Switch to
              sold listings before pricing.
            </p>
          </div>
        </div>
      )}
      <div className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              isWarning
                ? "bg-amber-50 text-amber-700"
                : "bg-emerald-50 text-emerald-700"
            }`}
          >
            <workflow.icon className="h-4 w-4" />
          </div>
          <h3 className="font-semibold text-slate-950">{workflow.title}</h3>
        </div>
        <p className="text-sm leading-6 text-slate-600">
          {workflow.description}
        </p>
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
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </article>
  );
}
