import { ArrowRight, Chrome, Github, Smartphone } from "lucide-react";

export const chromeExtensionDownloadUrl =
  "https://chromewebstore.google.com/detail/volt/bmgghhmlflbhlnomgnoodpidekpaaifk";
export const mobileAppDownloadUrl =
  "https://apps.apple.com/us/app/volt-scanner/id6771770148";
export const repositoryUrl = "https://github.com/JuanQuenga/Volt";
export const supportUrl = `${repositoryUrl}/issues`;
export const donateUrl = "https://github.com/sponsors/JuanQuenga";

const footerLinkGroups = [
  {
    title: "Links",
    links: [
      ["Create Web Session", "/session"],
      ["Support", supportUrl],
      ["Repository", repositoryUrl],
      ["Donate", donateUrl],
    ],
  },
];

type SiteHeaderProps = {
  anchorPrefix?: "" | "/";
  variant?: "marketing" | "scanner";
};

export function SiteHeader({
  anchorPrefix = "/",
  variant = "marketing",
}: SiteHeaderProps) {
  const isScanner = variant === "scanner";

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a
          href={anchorPrefix === "" ? "#top" : "/"}
          className="flex items-center gap-2"
          aria-label="Volt home"
        >
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="hidden text-sm font-semibold sm:inline">Volt</span>
        </a>
        {isScanner ? (
          <nav
            className="flex min-w-0 items-center text-sm text-zinc-600"
            aria-label="Primary"
          >
            <a
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm hover:border-zinc-900"
              href={supportUrl}
            >
              Support
              <ArrowRight size={14} />
            </a>
          </nav>
        ) : (
          <nav
            className="flex items-center gap-5 text-sm text-zinc-600 sm:gap-7"
            aria-label="Primary"
          >
            <a className="hover:text-zinc-950" href={supportUrl}>
              Support
            </a>
            <a
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm hover:border-zinc-900"
              href="/session"
            >
              New session
              <ArrowRight size={14} />
            </a>
          </nav>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer id="privacy" className="bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,44rem)_14rem] lg:gap-24">
          <div className="max-w-2xl">
            <a
              href="/"
              className="inline-flex items-center gap-2"
              aria-label="Volt home"
            >
              <img src="/favicon.svg" alt="" className="size-9" />
              <span className="text-base font-semibold">Volt</span>
            </a>
            <p className="mt-5 text-sm leading-6 text-zinc-300">
              Volt is an independent resale workflow project for pairing a
              Chrome extension with a companion mobile capture app.
            </p>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              Volt is not affiliated with, endorsed by, or sponsored by Volt
              Resale or Paymore Electronics.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href={mobileAppDownloadUrl}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.85rem] bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200"
              >
                <Smartphone size={16} />
                Mobile app
              </a>
              <a
                href={chromeExtensionDownloadUrl}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.85rem] border border-white/20 px-4 text-sm font-semibold text-white hover:border-white/45"
              >
                <Chrome size={16} />
                Chrome extension
              </a>
            </div>
          </div>

          <div className="grid gap-8">
            {footerLinkGroups.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {group.title}
                </h2>
                <div className="mt-4 grid gap-3">
                  {group.links.map(([label, href]) => (
                    <a
                      key={label}
                      href={href}
                      className="text-sm font-medium text-zinc-300 hover:text-white"
                    >
                      {label}
                    </a>
                  ))}
                </div>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Copyright {new Date().getFullYear()} Volt Scanner</p>
          <p className="inline-flex items-center gap-1.5">
            Open source on
            <a
              href={repositoryUrl}
              className="inline-flex items-center gap-1.5 font-medium text-zinc-400 hover:text-white"
            >
              <Github size={14} />
              GitHub
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
