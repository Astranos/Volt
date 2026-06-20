import { useState } from "react";
import { X } from "lucide-react";
import type { SaveExtensionSettings } from "@/src/hooks/useExtensionSettings";
import type { CmdkSettings } from "@/src/types/settings";

const DEFAULT_SEARCH_PROVIDERS = [
  { id: "google", name: "Google" },
  { id: "volt", name: "Volt Search" },
  { id: "amazon", name: "Amazon" },
  { id: "bestbuy", name: "Best Buy" },
  { id: "ebay", name: "eBay" },
  { id: "pricecharting", name: "Price Charting" },
  { id: "upcitemdb", name: "UPCItemDB" },
  { id: "youtube", name: "YouTube" },
  { id: "github", name: "GitHub" },
  { id: "twitter", name: "Twitter/X" },
  { id: "homedepot", name: "Home Depot" },
  { id: "lowes", name: "Lowe's" },
  { id: "menards", name: "Menards" },
  { id: "microcenter", name: "Micro Center" },
];

const EMPTY_PROVIDER = {
  name: "",
  triggers: [] as string[],
  searchUrl: "",
  color: "bg-blue-500",
};

interface SearchProvidersSettingsProps {
  settings: CmdkSettings;
  saveSettings: SaveExtensionSettings;
}

export function SearchProvidersSettings({
  settings,
  saveSettings,
}: SearchProvidersSettingsProps) {
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState(EMPTY_PROVIDER);

  const handleToggleSearchProvider = (providerId: string) => {
    void saveSettings({
      ...settings,
      enabledSearchProviders: {
        ...settings.enabledSearchProviders,
        [providerId]: !settings.enabledSearchProviders[providerId],
      },
    });
  };

  const handleAddCustomProvider = () => {
    if (
      !newProvider.name ||
      !newProvider.triggers.length ||
      !newProvider.searchUrl
    ) {
      return;
    }

    const id = newProvider.name.toLowerCase().replace(/\s+/g, "-");
    const customProvider = {
      id,
      name: newProvider.name,
      triggers: newProvider.triggers,
      searchUrl: newProvider.searchUrl,
      color: newProvider.color,
    };

    void saveSettings({
      ...settings,
      customSearchProviders: [
        ...settings.customSearchProviders,
        customProvider,
      ],
      enabledSearchProviders: {
        ...settings.enabledSearchProviders,
        [id]: true,
      },
    });

    setNewProvider(EMPTY_PROVIDER);
    setShowAddProvider(false);
  };

  const handleDeleteCustomProvider = (index: number) => {
    const providerToDelete = settings.customSearchProviders[index];
    const newCustomProviders = [...settings.customSearchProviders];
    newCustomProviders.splice(index, 1);

    const newEnabledProviders = { ...settings.enabledSearchProviders };
    delete newEnabledProviders[providerToDelete.id];

    void saveSettings({
      ...settings,
      customSearchProviders: newCustomProviders,
      enabledSearchProviders: newEnabledProviders,
    });
  };

  const isProviderEnabled = (providerId: string) =>
    settings.enabledSearchProviders[providerId] ||
    settings.enabledSearchProviders[providerId] === undefined;

  return (
    <section id="providers" className="scroll-mt-20">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">Search Providers</h2>
        <p className="text-muted-foreground">
          Configure built-in search engines and create custom search providers
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
        <div className="divide-y divide-border">
          <div className="p-8">
            <h3 className="font-semibold text-lg mb-5">Default Providers</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {DEFAULT_SEARCH_PROVIDERS.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <span className="text-sm font-medium">{provider.name}</span>
                  <ToggleSwitch
                    enabled={isProviderEnabled(provider.id)}
                    onClick={() => handleToggleSearchProvider(provider.id)}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="p-8">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-lg">Custom Providers</h3>
              <button
                onClick={() => setShowAddProvider(!showAddProvider)}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
              >
                Add Provider
              </button>
            </div>

            {settings.customSearchProviders.length > 0 ? (
              <div className="space-y-3">
                {settings.customSearchProviders.map((provider, index) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-semibold text-sm mb-1">
                        {provider.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Triggers: {provider.triggers.join(", ")}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <ToggleSwitch
                        enabled={isProviderEnabled(provider.id)}
                        onClick={() => handleToggleSearchProvider(provider.id)}
                        size="sm"
                      />
                      <button
                        onClick={() => handleDeleteCustomProvider(index)}
                        className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 px-4 bg-muted/20 rounded-lg border border-dashed border-border">
                <p className="text-sm text-muted-foreground">
                  No custom providers added yet. Click "Add Provider" to create
                  one.
                </p>
              </div>
            )}

            {showAddProvider && (
              <div className="mt-6 p-6 border border-border rounded-xl bg-muted/20">
                <h4 className="font-semibold text-base mb-4">
                  Add Custom Search Provider
                </h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Name
                    </label>
                    <input
                      type="text"
                      value={newProvider.name}
                      onChange={(event) =>
                        setNewProvider({
                          ...newProvider,
                          name: event.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                      placeholder="e.g., Wikipedia"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Triggers (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={newProvider.triggers.join(", ")}
                      onChange={(event) =>
                        setNewProvider({
                          ...newProvider,
                          triggers: event.target.value
                            .split(",")
                            .map((trigger) => trigger.trim())
                            .filter((trigger) => trigger),
                        })
                      }
                      className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                      placeholder="e.g., wiki, w"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Search URL
                    </label>
                    <input
                      type="text"
                      value={newProvider.searchUrl}
                      onChange={(event) =>
                        setNewProvider({
                          ...newProvider,
                          searchUrl: event.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                      placeholder="e.g., https://en.wikipedia.org/wiki/Special:Search?search={query}"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Use {"{query}"} as a placeholder for the search term
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Color
                    </label>
                    <select
                      value={newProvider.color}
                      onChange={(event) =>
                        setNewProvider({
                          ...newProvider,
                          color: event.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                    >
                      <option value="bg-blue-500">Blue</option>
                      <option value="bg-green-500">Green</option>
                      <option value="bg-red-500">Red</option>
                      <option value="bg-yellow-500">Yellow</option>
                      <option value="bg-purple-500">Purple</option>
                      <option value="bg-pink-500">Pink</option>
                      <option value="bg-indigo-500">Indigo</option>
                      <option value="bg-gray-500">Gray</option>
                    </select>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleAddCustomProvider}
                      disabled={
                        !newProvider.name ||
                        !newProvider.triggers.length ||
                        !newProvider.searchUrl
                      }
                      className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors shadow-sm"
                    >
                      Add Provider
                    </button>
                    <button
                      onClick={() => {
                        setShowAddProvider(false);
                        setNewProvider(EMPTY_PROVIDER);
                      }}
                      className="px-5 py-2.5 bg-muted text-foreground rounded-lg hover:bg-muted/80 font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ToggleSwitch({
  enabled,
  onClick,
  size = "md",
}: {
  enabled: boolean;
  onClick: () => void;
  size?: "sm" | "md";
}) {
  const trackClass =
    size === "sm" ? "h-6 w-11" : "h-7 w-12";
  const knobClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const translateClass = enabled
    ? size === "sm"
      ? "translate-x-6"
      : "translate-x-6"
    : "translate-x-1";

  return (
    <button
      onClick={onClick}
      className={`relative inline-flex ${trackClass} items-center rounded-full transition-colors ${
        enabled ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`inline-block ${knobClass} transform rounded-full bg-white shadow-sm transition-transform ${translateClass}`}
      />
    </button>
  );
}
