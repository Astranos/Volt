import { useState, type FormEvent } from "react";
import { mergePriceAuditSettings } from "../../domain/settings";
import { storeOrigin } from "../../price-audit/catalog";
import type { SaveExtensionSettings } from "../../hooks/useExtensionSettings";
import type { CmdkSettings, PriceAuditSettings as AuditPreferences } from "../../types/settings";

type Props = { settings: CmdkSettings; saveSettings: SaveExtensionSettings };

export function changePriceAuditStore(draft: AuditPreferences, storeUrl: string): AuditPreferences {
  return { ...draft, storeUrl, consentToProvider: false, usdConfirmed: false };
}

export function preparePriceAuditSettings(draft: AuditPreferences): AuditPreferences {
  const storeUrl = draft.storeUrl.trim() ? storeOrigin(draft.storeUrl) : "";
  if (!Number.isFinite(draft.tolerancePercent) || draft.tolerancePercent < 0 || draft.tolerancePercent > 50) {
    throw new Error("Choose a fair-price tolerance from 0 to 50%.");
  }
  if (!Number.isInteger(draft.maxSearchPages) || draft.maxSearchPages < 1 || draft.maxSearchPages > 5) {
    throw new Error("Choose 1 to 5 eBay pages per item.");
  }
  return {
    ...draft, storeUrl,
    consentToProvider: Boolean(storeUrl) && draft.consentToProvider,
    usdConfirmed: Boolean(storeUrl) && draft.usdConfirmed,
  };
}

export function PriceAuditSettings(props: Props) {
  const saved = mergePriceAuditSettings(props.settings.priceAudit);
  return <PriceAuditSettingsForm key={JSON.stringify(saved)} {...props} saved={saved} />;
}

function PriceAuditSettingsForm({ settings, saveSettings, saved }: Props & { saved: AuditPreferences }) {
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = "mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const priceAudit = preparePriceAuditSettings(draft);
      setSaving(true);
      await saveSettings({ ...settings, priceAudit });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Price Audit settings.");
    } finally { setSaving(false); }
  }

  return <section id="priceaudit" className="scroll-mt-24 space-y-4">
    <div><h2 className="text-xl font-semibold">Price Audit</h2><p className="mt-1 text-sm text-muted-foreground">Configure your public Shopify storefront and comparison preferences.</p></div>
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-border bg-card p-6">
      <label className="block text-sm font-medium">Shopify store URL
        <input className={field} type="text" inputMode="url" autoComplete="url" placeholder="your-store.com" value={draft.storeUrl} disabled={saving}
          onChange={(event) => setDraft(changePriceAuditStore(draft, event.target.value))} />
      </label>
      <p className="text-sm text-muted-foreground">Use the public storefront, not Shopify Admin. Bare domains are saved as HTTPS. Changing the store resets both confirmations; confirm below before saving.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Fair-price tolerance (%)<input className={field} type="number" min="0" max="50" step="any" required value={draft.tolerancePercent} disabled={saving} onChange={(event) => setDraft({ ...draft, tolerancePercent: event.target.valueAsNumber })} /></label>
        <label className="text-sm font-medium">eBay pages per item<input className={field} type="number" min="1" max="5" step="1" required value={draft.maxSearchPages} disabled={saving} onChange={(event) => setDraft({ ...draft, maxSearchPages: event.target.valueAsNumber })} /></label>
      </div>
      <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={draft.consentToProvider} disabled={saving || !draft.storeUrl.trim()} onChange={(event) => setDraft({ ...draft, consentToProvider: event.target.checked })} /><span>I agree to send public catalog and listing text to TypeSafe via Volt for Jev analysis.</span></label>
      <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={draft.usdConfirmed} disabled={saving || !draft.storeUrl.trim()} onChange={(event) => setDraft({ ...draft, usdConfirmed: event.target.checked })} /><span>I confirm this Shopify store and the compared listings use USD prices.</span></label>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>This is a read-only audit. It does not edit prices or inventory. Only publicly available Shopify variants and eBay sold/completed listings are considered.</p>
        <p>Results are a sample of visible sold listings, not all historical eBay sales. A price label requires at least 3 confident unique sold matches. Prices exclude shipping and tax.</p>
        <p>Closing the panel or switching tools ends the scan and loses this session. Export results before leaving. Stop ends local work immediately, but an in-flight server call may still finish.</p>
        <p>Server safety limits: 120 upstream requests per minute and 4,000 per day per account, plus a shared daily cap of 20,000. Retries count toward these limits.</p>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <button type="submit" disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Save Price Audit settings"}</button>
    </form>
  </section>;
}
