import { ArrowRight, BookOpen, History, Settings, type LucideIcon } from "lucide-react";

const sections: Array<{ href: string; title: string; body: string; icon: LucideIcon }> = [
  {
    href: "/scanner-results",
    title: "Capture history",
    body: "Barcodes, text, and photos sent from your phone. Search, copy, and export them as CSV.",
    icon: History,
  },
  {
    href: "/handbook",
    title: "Handbook",
    body: "Store info, logins, setup guides, and procedures. Edits show up in the Chrome extension right away.",
    icon: BookOpen,
  },
  {
    href: "/settings",
    title: "Settings",
    body: "Your account, how much capture storage you're using, and the Donut apps.",
    icon: Settings,
  },
];

export function DashboardHome() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Dashboard</h1>
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          Everything your phone and Chrome share, in one place.
        </p>
      </header>
      <nav aria-label="Workspace sections" className="grid gap-3 md:grid-cols-3">
        {sections.map(({ href, title, body, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="group flex flex-col rounded-[1.2rem] border border-zinc-200 bg-white p-5 transition-colors hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <span className="grid size-10 place-items-center rounded-[0.8rem] bg-emerald-50 text-emerald-700">
              <Icon aria-hidden="true" className="size-5" />
            </span>
            <span className="mt-4 text-sm font-semibold text-zinc-950">{title}</span>
            <span className="mt-1 flex-1 text-sm leading-6 text-zinc-500">{body}</span>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 group-hover:text-emerald-800">
              Open
              <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </a>
        ))}
      </nav>
    </div>
  );
}
