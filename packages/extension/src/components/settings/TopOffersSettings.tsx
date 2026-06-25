import { useState } from "react";
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { DEFAULT_SETTINGS } from "@/src/domain/settings";
import {
  addCustomTopOffer,
  addCustomTopOfferRule,
  addCustomTopOfferStartingRule,
  addTopOfferRateRule,
  addTopOfferStartingRateRule,
  deleteCustomTopOffer,
  DEFAULT_CUSTOM_RATES,
  DEFAULT_ENABLED_OFFER_TYPES,
  DEFAULT_STARTING_RATES,
  removeCustomTopOfferRule,
  removeCustomTopOfferStartingRule,
  removeTopOfferRateRule,
  removeTopOfferStartingRateRule,
  setBuiltInTopOfferEnabled,
  setBuiltInTopOfferStartingRatesEnabled,
  setCustomTopOfferEnabled,
  setCustomTopOfferStartingRatesEnabled,
  sortCustomTopOfferStartingRules,
  sortCustomTopOfferRules,
  sortTopOfferStartingRateRules,
  sortTopOfferRateRules,
  updateCustomTopOfferDefaultPercentage,
  updateCustomTopOfferName,
  updateCustomTopOfferRule,
  updateCustomTopOfferStartingDefaultPercentage,
  updateCustomTopOfferStartingRule,
  updateTopOfferCheckoutRate,
  updateTopOfferDefaultPercentage,
  updateTopOfferRateRule,
  updateTopOfferStartingDefaultPercentage,
  updateTopOfferStartingRateRule,
  type BuiltInTopOfferType,
  type BuiltInTopOfferRateType,
  type BuiltInStartingRateType,
} from "@/src/domain/top-offers";
import type { SaveExtensionSettings } from "@/src/hooks/useExtensionSettings";
import type { CmdkSettings, RateRule } from "@/src/types/settings";
import { Switch } from "@/src/components/ui/switch";
import { RateRuleEditor } from "./TopOfferRuleEditor";

interface TopOffersSettingsProps {
  settings: CmdkSettings;
  saveSettings: SaveExtensionSettings;
}

function OfferEnabledSwitch({
  ariaLabel,
  checked,
  onChange,
}: {
  ariaLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch
      checked={checked}
      aria-label={ariaLabel}
      onCheckedChange={onChange}
    />
  );
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
  const startingRates = settings.topOffers?.startingRates || {};
  const customOffers = settings.topOffers?.customOffers || [];
  const enabledOfferTypes = {
    ...DEFAULT_ENABLED_OFFER_TYPES,
    ...(settings.topOffers?.enabledOfferTypes || {}),
  };

  const handleToggleBuiltInOffer = (
    type: BuiltInTopOfferType,
    enabled: boolean
  ) => {
    saveTopOffers(setBuiltInTopOfferEnabled(settings.topOffers, type, enabled));
  };

  const handleToggleBuiltInStartRates = (
    type: BuiltInStartingRateType,
    enabled: boolean
  ) => {
    saveTopOffers(
      setBuiltInTopOfferStartingRatesEnabled(settings.topOffers, type, enabled)
    );
  };

  const getBuiltInStartRates = (type: BuiltInStartingRateType) => {
    if (startingRates[type]) return startingRates[type]!;
    if (type === "checkout" || type === "newCustomer") {
      return customRates.standard;
    }
    return DEFAULT_STARTING_RATES[type];
  };

  const renderBuiltInStartEditor = (type: BuiltInStartingRateType) => {
    if (!startingRates[type]) return null;
    const rates = getBuiltInStartRates(type);
    return (
      <RateRuleEditor
        title="Start Rates"
        rules={rates.rules}
        defaultPercentage={rates.defaultPercentage}
        onRuleChange={(index, field, value) =>
          saveTopOffers(
            updateTopOfferStartingRateRule(
              settings.topOffers,
              type,
              index,
              field,
              value
            )
          )
        }
        onSortRules={() =>
          saveTopOffers(sortTopOfferStartingRateRules(settings.topOffers, type))
        }
        onAddRule={() =>
          saveTopOffers(addTopOfferStartingRateRule(settings.topOffers, type))
        }
        onRemoveRule={(index) =>
          saveTopOffers(
            removeTopOfferStartingRateRule(settings.topOffers, type, index)
          )
        }
        onDefaultPercentageChange={(value) =>
          saveTopOffers(
            updateTopOfferStartingDefaultPercentage(
              settings.topOffers,
              type,
              value
            )
          )
        }
      />
    );
  };

  const renderStartToggle = (type: BuiltInStartingRateType) => (
    <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
      <span className="text-sm font-medium">Customize Start</span>
      <Switch
        checked={Boolean(startingRates[type])}
        aria-label={`Customize ${type} start rates`}
        onCheckedChange={(enabled) =>
          handleToggleBuiltInStartRates(type, enabled)
        }
      />
    </div>
  );

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
              startingRates: undefined,
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
          <div>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="font-semibold text-lg">Standard Rates</h3>
              <OfferEnabledSwitch
                ariaLabel="Standard rates enabled"
                checked={enabledOfferTypes.standard}
                onChange={(enabled) =>
                  handleToggleBuiltInOffer("standard", enabled)
                }
              />
            </div>
            {renderStartToggle("standard")}
            {renderBuiltInStartEditor("standard")}
            {startingRates.standard ? (
              <div className="my-6 border-t border-border" />
            ) : null}
            <RateRuleEditor
              title="Max Rates"
              rules={
                customRates.standard.rules ||
                DEFAULT_SETTINGS.topOffers!.customRates!.standard.rules
              }
              defaultPercentage={customRates.standard.defaultPercentage ?? 0.65}
              onRuleChange={(index, field, value) =>
                handleUpdateRateRule("standard", index, field, value)
              }
              onSortRules={() =>
                saveTopOffers(
                  sortTopOfferRateRules(settings.topOffers, "standard")
                )
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
                  updateTopOfferDefaultPercentage(
                    settings.topOffers,
                    "standard",
                    value
                  )
                )
              }
            />
          </div>

          <div className="border-t border-border" />

          <div>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="font-semibold text-lg">Premium Rates</h3>
              <OfferEnabledSwitch
                ariaLabel="Premium rates enabled"
                checked={enabledOfferTypes.premium}
                onChange={(enabled) =>
                  handleToggleBuiltInOffer("premium", enabled)
                }
              />
            </div>
            {renderStartToggle("premium")}
            {renderBuiltInStartEditor("premium")}
            {startingRates.premium ? (
              <div className="my-6 border-t border-border" />
            ) : null}
            <RateRuleEditor
              title="Max Rates"
              rules={
                customRates.premium.rules ||
                DEFAULT_SETTINGS.topOffers!.customRates!.premium.rules
              }
              defaultPercentage={customRates.premium.defaultPercentage ?? 0.75}
              onRuleChange={(index, field, value) =>
                handleUpdateRateRule("premium", index, field, value)
              }
              onSortRules={() =>
                saveTopOffers(
                  sortTopOfferRateRules(settings.topOffers, "premium")
                )
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
                  updateTopOfferDefaultPercentage(
                    settings.topOffers,
                    "premium",
                    value
                  )
                )
              }
            />
          </div>

          <div className="border-t border-border" />

          <div>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="font-semibold text-lg">New Customer Rates</h3>
              <OfferEnabledSwitch
                ariaLabel="New customer rates enabled"
                checked={enabledOfferTypes.newCustomer}
                onChange={(enabled) =>
                  handleToggleBuiltInOffer("newCustomer", enabled)
                }
              />
            </div>
            {renderStartToggle("newCustomer")}
            {renderBuiltInStartEditor("newCustomer")}
            {startingRates.newCustomer ? (
              <div className="my-6 border-t border-border" />
            ) : null}
            <RateRuleEditor
              title="Max Rates"
              rules={
                customRates.newCustomer?.rules ||
                DEFAULT_SETTINGS.topOffers!.customRates!.newCustomer!.rules
              }
              defaultPercentage={
                customRates.newCustomer?.defaultPercentage ??
                DEFAULT_SETTINGS.topOffers!.customRates!.newCustomer!
                  .defaultPercentage
              }
              onRuleChange={(index, field, value) =>
                handleUpdateRateRule("newCustomer", index, field, value)
              }
              onSortRules={() =>
                saveTopOffers(
                  sortTopOfferRateRules(settings.topOffers, "newCustomer")
                )
              }
              onAddRule={() =>
                saveTopOffers(
                  addTopOfferRateRule(settings.topOffers, "newCustomer")
                )
              }
              onRemoveRule={(index) =>
                saveTopOffers(
                  removeTopOfferRateRule(
                    settings.topOffers,
                    "newCustomer",
                    index
                  )
                )
              }
              onDefaultPercentageChange={(value) =>
                saveTopOffers(
                  updateTopOfferDefaultPercentage(
                    settings.topOffers,
                    "newCustomer",
                    value
                  )
                )
              }
            />
          </div>

          <div className="border-t border-border" />

          <div>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="font-semibold text-lg">Checkout Rate</h3>
              <OfferEnabledSwitch
                ariaLabel="Checkout rate enabled"
                checked={enabledOfferTypes.checkout}
                onChange={(enabled) =>
                  handleToggleBuiltInOffer("checkout", enabled)
                }
              />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Set the percentage used for the "Checkout Offer" max calculation.
              By default, the starting value uses the standard top-offer guide.
            </p>
            {renderStartToggle("checkout")}
            {renderBuiltInStartEditor("checkout")}
            {startingRates.checkout ? <div className="my-6 border-t border-border" /> : null}
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
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={offer.enabled ?? true}
                          aria-label={`${offer.name} enabled`}
                          onCheckedChange={(enabled) =>
                            saveTopOffers(
                              setCustomTopOfferEnabled(
                                settings.topOffers,
                                offer.id,
                                enabled
                              )
                            )
                          }
                        />
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
                    </div>

                    <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3">
                      <span className="text-sm font-medium">
                        Customize Start
                      </span>
                      <Switch
                        checked={Boolean(offer.startingRules)}
                        aria-label={`${offer.name} start rates enabled`}
                        onCheckedChange={(enabled) =>
                          saveTopOffers(
                            setCustomTopOfferStartingRatesEnabled(
                              settings.topOffers,
                              offer.id,
                              enabled
                            )
                          )
                        }
                      />
                    </div>

                    {offer.startingRules ? (
                      <>
                        <RateRuleEditor
                          title="Start Rates"
                          rules={offer.startingRules}
                          defaultPercentage={
                            offer.startingDefaultPercentage ??
                            customRates.standard.defaultPercentage
                          }
                          onRuleChange={(ruleIndex, field, value) =>
                            saveTopOffers(
                              updateCustomTopOfferStartingRule(
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
                              sortCustomTopOfferStartingRules(
                                settings.topOffers,
                                offer.id
                              )
                            )
                          }
                          onAddRule={() =>
                            saveTopOffers(
                              addCustomTopOfferStartingRule(
                                settings.topOffers,
                                offer.id
                              )
                            )
                          }
                          onRemoveRule={(ruleIndex) =>
                            saveTopOffers(
                              removeCustomTopOfferStartingRule(
                                settings.topOffers,
                                offer.id,
                                ruleIndex
                              )
                            )
                          }
                          onDefaultPercentageChange={(value) =>
                            saveTopOffers(
                              updateCustomTopOfferStartingDefaultPercentage(
                                settings.topOffers,
                                offer.id,
                                value
                              )
                            )
                          }
                        />
                        <div className="my-6 border-t border-border" />
                      </>
                    ) : null}

                    <RateRuleEditor
                      title="Max Rates"
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
