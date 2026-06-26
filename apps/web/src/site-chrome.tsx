import { ArrowRight } from "lucide-react";

export const chromeExtensionDownloadUrl =
  "https://chromewebstore.google.com/search/Volt%20Chrome%20extension";
export const mobileAppDownloadUrl = "https://apps.apple.com/us/search?term=Volt%20mobile%20scanner";
export const repositoryUrl = "https://github.com/JuanQuenga/Volt";
export const supportUrl = `${repositoryUrl}/issues`;

const footerLinkGroups = [
  {
    title: "Project",
    links: [
      ["GitHub repo", repositoryUrl],
      ["Support", supportUrl],
      ["Chrome extension", chromeExtensionDownloadUrl],
      ["Mobile app", mobileAppDownloadUrl],
    ],
  },
  {
    title: "Web",
    links: [
      ["Home", "/"],
      ["Mobile capture", "/#scanner"],
      ["Privacy", "/#privacy"],
      ["Web scanner", "/session"],
      ["App review demo", "/scanner-demo"],
    ],
  },
];

type SiteHeaderProps = {
  anchorPrefix?: "" | "/";
};

export function SiteHeader({ anchorPrefix = "/" }: SiteHeaderProps) {
  const scannerHref = `${anchorPrefix}#scanner`;
  const privacyHref = `${anchorPrefix}#privacy`;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href={anchorPrefix === "" ? "#top" : "/"} className="flex items-center gap-2" aria-label="Volt home">
          <img src="/assets/volt.webp" alt="" className="size-8 rounded-[0.65rem] object-cover" />
          <span className="text-sm font-semibold">Volt</span>
        </a>
        <nav className="flex items-center gap-5 text-sm text-zinc-600 sm:gap-7" aria-label="Primary">
          <a className="hidden hover:text-zinc-950 sm:inline" href={scannerHref}>
            Capture
          </a>
          <a className="hidden hover:text-zinc-950 sm:inline" href="/session">
            Web scanner
          </a>
          <a className="hidden hover:text-zinc-950 sm:inline" href={privacyHref}>
            Privacy
          </a>
          <a
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm hover:border-zinc-900"
            href={supportUrl}
          >
            Support
            <ArrowRight size={14} />
          </a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer id="privacy" className="bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="max-w-2xl">
            <a href="/" className="inline-flex items-center gap-2" aria-label="Volt home">
              <img src="/assets/volt.webp" alt="" className="size-9 rounded-[0.75rem]" />
              <span className="text-base font-semibold">Volt</span>
            </a>
            <p className="mt-5 text-sm leading-6 text-zinc-300">
              Volt is an independent resale workflow project for pairing a Chrome extension with a companion mobile capture app.
            </p>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              Volt is not affiliated with, endorsed by, or sponsored by Volt Resale or Paymore Electronics.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            {footerLinkGroups.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{group.title}</h2>
                <div className="mt-4 grid gap-3">
                  {group.links.map(([label, href]) => (
                    <a key={label} href={href} className="text-sm font-medium text-zinc-300 hover:text-white">
                      {label}
                    </a>
                  ))}
                </div>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Copyright {new Date().getFullYear()} Volt.</p>
          <p>Chrome extension, mobile scanner, and web support surface for resale workflows.</p>
        </div>
      </div>
    </footer>
  );
}
