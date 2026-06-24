import { useEffect, useState } from "react";
import {
  Barcode,
  Bookmark,
  Calculator,
  Check,
  Layers,
  Link2,
  Menu,
  MousePointerClick,
  Images,
  ScanLine,
  Search as SearchIcon,
  BadgeAlert,
} from "lucide-react";
import { BookmarkFoldersSettings } from "@/src/components/settings/BookmarkFoldersSettings";
import { CsvCacheSettings } from "@/src/components/settings/CsvCacheSettings";
import { FeatureTogglesSettings } from "@/src/components/settings/FeatureTogglesSettings";
import { SearchProvidersSettings } from "@/src/components/settings/SearchProvidersSettings";
import { TopOffersSettings } from "@/src/components/settings/TopOffersSettings";
import { useExtensionSettings } from "@/src/hooks/useExtensionSettings";

const NAV_ITEMS = [
  { href: "#newtab", icon: ScanLine, label: "New Tab Override" },
  { href: "#sources", icon: Layers, label: "Command Menu" },
  { href: "#bookmarks", icon: Bookmark, label: "Bookmarks" },
  { href: "#providers", icon: SearchIcon, label: "Search Providers" },
  { href: "#ebay", icon: BadgeAlert, label: "Sold Listing Warning" },
  { href: "#upc", icon: Barcode, label: "UPC Highlighter" },
  { href: "#contextmenu", icon: MousePointerClick, label: "Context Menu" },
  { href: "#mobilephotos", icon: Images, label: "Mobile Photos" },
  { href: "#csvlinks", icon: Link2, label: "Quick Links" },
  { href: "#topoffers", icon: Calculator, label: "Offer Calculator" },
];

export default function SettingsPage() {
  const { settings, setSettings, isSaved, saveSettings, resetSettings } =
    useExtensionSettings();
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    setVersion(chrome.runtime.getManifest().version);

    const handleHashChange = () => {
      const hash = window.location.hash.substring(1);
      if (hash) {
        setTimeout(() => {
          const element = document.getElementById(hash);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);
      }
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 text-foreground">
      <div className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-16 items-center px-6">
          <div className="flex items-center gap-3">
            <img
              src="/assets/icons/volt.webp"
              alt="Volt"
              className="w-10 h-10"
            />
            <div>
              <h1 className="text-lg font-bold">Volt Settings</h1>
              {version && (
                <p className="text-xs text-muted-foreground">
                  Version {version}
                </p>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {isSaved && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-green-700 bg-green-50 rounded-lg">
                <Check className="w-4 h-4" />
                <span className="text-sm font-medium">Saved!</span>
              </div>
            )}
            <button
              onClick={() => void resetSettings()}
              className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors text-sm font-medium"
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>

      <div className="flex max-w-[1800px] mx-auto">
        <aside className="sticky top-16 h-[calc(100vh-4rem)] w-64 border-r border-border/40 bg-background/50 backdrop-blur p-6">
          <nav className="space-y-1">
            {NAV_ITEMS.map(({ href, icon: Icon, label }) => (
              <a
                key={href}
                href={href}
                className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted/50 transition-colors text-foreground"
              >
                <Icon className="w-4 h-4" />
                {label}
              </a>
            ))}
          </nav>

          <div className="mt-8 p-4 bg-muted/30 rounded-lg border border-border/40">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground block mb-2">Quick Tip</strong>
              Drag the <Menu className="w-3 h-3 inline" /> icon to reorder
              sources. Changes are saved automatically.
            </p>
          </div>
        </aside>

        <main className="flex-1 p-8 space-y-12 max-w-5xl">
          <FeatureTogglesSettings
            settings={settings}
            setSettings={setSettings}
            saveSettings={saveSettings}
          />
          <BookmarkFoldersSettings
            settings={settings}
            saveSettings={saveSettings}
          />
          <SearchProvidersSettings
            settings={settings}
            saveSettings={saveSettings}
          />
          <CsvCacheSettings settings={settings} saveSettings={saveSettings} />
          <TopOffersSettings settings={settings} saveSettings={saveSettings} />
        </main>
      </div>
    </div>
  );
}
