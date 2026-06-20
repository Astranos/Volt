import { useState } from "react";
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { DEFAULT_SETTINGS } from "@/src/domain/settings";
import {
  addCustomTopOffer,
  addCustomTopOfferRule,
  addTopOfferRateRule,
  deleteCustomTopOffer,
  DEFAULT_CUSTOM_RATES,
  removeCustomTopOfferRule,
  removeTopOfferRateRule,
  sortCustomTopOfferRules,
  sortTopOfferRateRules,
  updateCustomTopOfferDefaultPercentage,
  updateCustomTopOfferName,
  updateCustomTopOfferRule,
  updateTopOfferCheckoutRate,
  updateTopOfferDefaultPercentage,
  updateTopOfferRateRule,
  type BuiltInTopOfferRateType,
} from "@/src/domain/top-offers";
import type { SaveExtensionSettings } from "@/src/hooks/useExtensionSettings";
import type { CmdkSettings, RateRule } from "@/src/types/settings";
import { RateRuleEditor } from "./TopOfferRuleEditor";

interface TopOffersSettingsProps {
  settings: CmdkSettings;
  saveSettings: SaveExtensionSettings;
}

export function TopOffersSettings({
  settings,
  saveSettings,
}: TopOffersSettingsProps) {
  const [editingCustomOffer, setEditingCustomOffer] = useState<string | null>(
    null
  );
  const [newCustomOfferName, setNewCustomOfferName] = useState("");

  const saveTopOffers = (topOffers: CmdkSettings["topOffers"]) => {
    void saveSettings({
      ...settings,
      topOffers,
    });
  };

  const handleUpdateRateRule = (
    type: BuiltInTopOfferRateType,
    index: number,
    field: keyof RateRule,
    value: number
  ) => {
    saveTopOffers(updateTopOfferRateRule(settings.topOffers, type, index, field, value));
  };

  const handleAddCustomOffer = () => {
    const id = `custom-${Date.now()}`;
    saveTopOffers(addCustomTopOffer(settings.topOffers, id));
    setEditingCustomOffer(id);
    setNewCustomOfferName("Custom Offer");
  };

  const handleUpdateCustomOfferName = (offerId: string, name: string) => {
    saveTopOffers(updateCustomTopOfferName(settings.topOffers, offerId, name));
    setEditingCustomOffer(null);
  };

  const customRates =
    settings.topOffers?.customRates || DEFAULT_SETTINGS.topOffers!.customRates!;
  const customOffers = settings.topOffers?.customOffers || [];

  return (
    <section id="topoffers" className="scroll-mt-20">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">Offer Calculator</h2>
          <p className="text-muted-foreground">
            Configure settings for the Offer Calculator
          </p>
        </div>
        <button
          onClick={() =>
            saveTopOffers({
              ...settings.topOffers,
              customRates: DEFAULT_CUSTOM_RATES,
            })
          }
          className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground hover:bg-muted/80 rounded-lg transition-colors text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          Reset Rates
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-lg overflow-hidden">
        <div className="p-8 space-y-8">
          <RateRuleEditor
            title="Standard Rates"
            rules={
              customRates.standard.rules ||
              DEFAULT_SETTINGS.topOffers!.customRates!.standard.rules
            }
            defaultPercentage={customRates.standard.defaultPercentage ?? 0.65}
            onRuleChange={(index, field, value) =>
              handleUpdateRateRule("standard", index, field, value)
            }
            onSortRules={() =>
              saveTopOffers(sortTopOfferRateRules(settings.topOffers, "standard"))
            }
            onAddRule={() =>
              saveTopOffers(addTopOfferRateRule(settings.topOffers, "standard"))
            }
            onRemoveRule={(index) =>
              saveTopOffers(
                removeTopOfferRateRule(settings.topOffers, "standard", index)
              )
            }
            onDefaultPercentageChange={(value) =>
              saveTopOffers(
                updateTopOfferDefaultPercentage(settings.topOffers, "standard", value)
              )
            }
          />

          <div className="border-t border-border" />

          <RateRuleEditor
            title="Premium Rates"
            rules={
              customRates.premium.rules ||
              DEFAULT_SETTINGS.topOffers!.customRates!.premium.rules
            }
            defaultPercentage={customRates.premium.defaultPercentage ?? 0.75}
            onRuleChange={(index, field, value) =>
              handleUpdateRateRule("premium", index, field, value)
            }
            onSortRules={() =>
              saveTopOffers(sortTopOfferRateRules(settings.topOffers, "premium"))
            }
            onAddRule={() =>
              saveTopOffers(addTopOfferRateRule(settings.topOffers, "premium"))
            }
            onRemoveRule={(index) =>
              saveTopOffers(
                removeTopOfferRateRule(settings.topOffers, "premium", index)
              )
            }
            onDefaultPercentageChange={(value) =>
              saveTopOffers(
                updateTopOfferDefaultPercentage(settings.topOffers, "premium", value)
              )
            }
          />

          <div className="border-t border-border" />

          <div>
            <h3 className="font-semibold text-lg mb-4">Checkout Rate</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Set the percentage used for the "Checkout Offer" top calculation.
              The starting value uses the standard top-offer guide.
            </p>
            <div className="grid grid-cols-12 gap-4 items-center">
              <div className="col-span-5 text-sm font-medium pl-2">
                All amounts
              </div>
              <div className="col-span-5">
                <input
                  type="number"
                  step="0.01"
                  value={
                    customRates.checkout?.percentage ??
                    DEFAULT_CUSTOM_RATES.checkout!.percentage
                  }
                  onChange={(event) =>
                    saveTopOffers(
                      updateTopOfferCheckoutRate(
                        settings.topOffers,
                        parseFloat(event.target.value)
                      )
                    )
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                />
              </div>
              <div className="col-span-2"></div>
            </div>
          </div>

          <div className="border-t border-border" />

          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-lg">Custom Offers</h3>
                <p className="text-sm text-muted-foreground">
                  Create custom offer calculations with your own rates
                </p>
              </div>
              <button
                onClick={handleAddCustomOffer}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                Add Custom Offer
              </button>
            </div>

            {customOffers.length > 0 ? (
              <div className="space-y-6">
                {customOffers.map((offer) => (
                  <div
                    key={offer.id}
                    className="p-4 border border-border rounded-lg bg-muted/20"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        {editingCustomOffer === offer.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={newCustomOfferName}
                              onChange={(event) =>
                                setNewCustomOfferName(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  handleUpdateCustomOfferName(
                                    offer.id,
                                    newCustomOfferName
                                  );
                                }
                                if (event.key === "Escape") {
                                  setEditingCustomOffer(null);
                                }
                              }}
                              className="px-3 py-1.5 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors text-base font-semibold"
                              autoFocus
                            />
                            <button
                              onClick={() =>
                                handleUpdateCustomOfferName(
                                  offer.id,
                                  newCustomOfferName
                                )
                              }
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setEditingCustomOffer(null)}
                              className="p-1.5 text-muted-foreground hover:bg-muted rounded-lg transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <h4 className="font-semibold text-base">
                              {offer.name}
                            </h4>
                            <button
                              onClick={() => {
                                setEditingCustomOffer(offer.id);
                                setNewCustomOfferName(offer.name);
                              }}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          saveTopOffers(
                            deleteCustomTopOffer(settings.topOffers, offer.id)
                          )
                        }
                        className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <RateRuleEditor
                      rules={offer.rules}
                      defaultPercentage={offer.defaultPercentage}
                      onRuleChange={(ruleIndex, field, value) =>
                        saveTopOffers(
                          updateCustomTopOfferRule(
                            settings.topOffers,
                            offer.id,
                            ruleIndex,
                            field,
                            value
                          )
                        )
                      }
                      onSortRules={() =>
                        saveTopOffers(
                          sortCustomTopOfferRules(settings.topOffers, offer.id)
                        )
                      }
                      onAddRule={() =>
                        saveTopOffers(
                          addCustomTopOfferRule(settings.topOffers, offer.id)
                        )
                      }
                      onRemoveRule={(ruleIndex) =>
                        saveTopOffers(
                          removeCustomTopOfferRule(
                            settings.topOffers,
                            offer.id,
                            ruleIndex
                          )
                        )
                      }
                      onDefaultPercentageChange={(value) =>
                        saveTopOffers(
                          updateCustomTopOfferDefaultPercentage(
                            settings.topOffers,
                            offer.id,
                            value
                          )
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 px-4 bg-muted/20 rounded-lg border border-dashed border-border">
                <p className="text-sm text-muted-foreground">
                  No custom offers added yet. Click "Add Custom Offer" to create
                  one with your own rates.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
