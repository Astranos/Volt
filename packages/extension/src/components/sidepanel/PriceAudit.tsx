import React, { useEffect, useRef, useState } from "react";
import { runPriceAudit } from "../../price-audit/runner";
import type { AuditAssessment, AuditSettings, AuditSnapshot, ItemResult } from "../../price-audit/types";
import SidepanelLayout from "./SidepanelLayout";

const idle: AuditSnapshot = { status: "idle", phase: "Ready", total: 0, processed: 0, catalogComplete: false, results: [], error: null, startedAt: null, requests: 0 };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const labels: Record<AuditAssessment["kind"], string> = { high: "Too high", low: "Too low", fair: "Just right", insufficient: "Insufficient evidence" };
const badges: Record<AuditAssessment["kind"], string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  low: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  fair: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  insufficient: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};
const field = "w-full rounded border border-border bg-background p-2 text-sm disabled:opacity-50";

export function PriceAuditResult({ result }: { result: ItemResult }) {
  const { item, assessment, comparables } = result;
  return <article className="space-y-2 rounded-lg border border-border p-3 text-sm">
    <span className={`inline-block rounded px-2 py-1 text-xs font-medium ${badges[assessment.kind]}`}>{labels[assessment.kind]}</span>
    <h3 className="break-words font-semibold"><a href={item.url} target="_blank" rel="noreferrer" className="underline">{item.title}</a></h3>
    <p className="break-words text-xs text-muted-foreground">{item.variant}{item.sku ? ` · ${item.sku}` : ""}</p>
    <p>Store: {money.format(item.priceCents / 100)} USD</p>
    {assessment.kind === "insufficient" ? <p>{assessment.reason}</p> : <>
      <p>Sold median: {money.format(assessment.medianCents / 100)} USD</p>
      <p>{assessment.differencePercent > 0 ? "+" : ""}{assessment.differencePercent.toFixed(1)}% vs. sold median</p>
      <p className="text-xs text-muted-foreground">Fair band: {money.format(assessment.lowCents / 100)}–{money.format(assessment.highCents / 100)}</p>
    </>}
    <details>
      <summary className="cursor-pointer font-medium">Sold evidence ({comparables.length})</summary>
      <div className="mt-2 space-y-3 text-xs">
        {result.note ? <p>{result.note}</p> : null}
        {result.searchUrl ? <a className="block underline" href={result.searchUrl} target="_blank" rel="noreferrer">Open sold/completed search</a> : null}
        <p className="text-muted-foreground">Checked {new Date(result.checkedAt).toLocaleString()}</p>
        {comparables.map((comparable) => <div key={comparable.id} className="space-y-1 border-t border-border pt-2">
          <a href={comparable.url} target="_blank" rel="noreferrer" className="underline">{money.format(comparable.priceCents / 100)} USD sold listing</a>
          <p className="break-words whitespace-pre-wrap">{comparable.text}</p>
          <p className="text-muted-foreground">Match confidence: {Math.round(comparable.confidence * 100)}%</p>
        </div>)}
      </div>
    </details>
  </article>;
}

export function serializePriceAudit(snapshot: AuditSnapshot, settings: AuditSettings): string {
  return JSON.stringify({ version: 1, settings, coverage: "Public available Shopify variants; capped eBay sold/completed searches, not all historical sales. USD item prices exclude shipping and tax.", snapshot }, null, 2);
}

export default function PriceAudit() {
  const [storeUrl, setStoreUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [tolerance, setTolerance] = useState("15");
  const [pages, setPages] = useState("2");
  const [consent, setConsent] = useState(false);
  const [usdConfirmed, setUsdConfirmed] = useState(false);
  const [snapshot, setSnapshot] = useState<AuditSnapshot>(idle);
  const [runSettings, setRunSettings] = useState<AuditSettings | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const downloadUrl = useRef<string | null>(null);
  const busy = snapshot.status === "running" || snapshot.status === "stopping";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    };
  }, []);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controller.current) return;
    setFormError(null);
    let normalizedUrl: URL;
    try {
      normalizedUrl = new URL(storeUrl);
      if (normalizedUrl.protocol !== "https:" || normalizedUrl.username || normalizedUrl.password) throw new Error();
    } catch {
      setFormError("Enter a public HTTPS Shopify store URL without credentials.");
      return;
    }
    const tolerancePercent = Number(tolerance);
    const maxSearchPages = Number(pages);
    if (!tolerance.trim() || !Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 50 || !Number.isInteger(maxSearchPages) || maxSearchPages < 1 || maxSearchPages > 5) {
      setFormError("Use a tolerance from 0 to 50 percent and 1 to 5 search pages.");
      return;
    }
    if (!apiKey.trim() || !consent || !usdConfirmed) {
      setFormError("Enter your Jev API key and confirm both checkboxes.");
      return;
    }
    const activeController = new AbortController();
    controller.current = activeController;
    const settings = { storeUrl: normalizedUrl.origin, tolerancePercent, maxSearchPages };
    const key = apiKey.trim();
    setApiKey("");
    setRunSettings(settings);
    setSnapshot({ ...idle, status: "running", phase: "Starting", startedAt: new Date().toISOString() });
    try {
      await runPriceAudit({ settings, apiKey: key, signal: activeController.signal, onUpdate: (next) => {
        if (mounted.current && controller.current === activeController) setSnapshot(next);
      } });
    } catch {
      if (mounted.current) setSnapshot((previous) => ({ ...previous, status: activeController.signal.aborted ? "stopped" : "error", error: activeController.signal.aborted ? null : "The audit could not finish. Partial results are retained." }));
    } finally {
      if (controller.current === activeController) controller.current = null;
    }
  }

  function stop() {
    setSnapshot((previous) => ({ ...previous, status: "stopping", phase: "Stopping after cancellation" }));
    controller.current?.abort();
  }

  function exportResults() {
    if (!runSettings) return;
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = URL.createObjectURL(new Blob([serializePriceAudit(snapshot, runSettings)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = downloadUrl.current;
    anchor.download = "volt-price-audit.json";
    anchor.click();
  }

  return <SidepanelLayout><div className="space-y-4 p-4">
    <header><h2 className="text-lg font-semibold">Shopify price audit</h2><p className="mt-1 text-xs text-muted-foreground">Jev checks public inventory against matching eBay sold and completed listings. No store prices are changed.</p></header>
    <form onSubmit={start} className="space-y-3">
      <label className="block space-y-1 text-sm">Shopify store URL<input className={field} type="url" required placeholder="https://your-store.com" value={storeUrl} onChange={(event) => setStoreUrl(event.target.value)} disabled={busy} /></label>
      <label className="block space-y-1 text-sm">Jev API key<input className={field} type="password" autoComplete="off" required={!busy} value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={busy} /></label>
      <p className="text-xs text-muted-foreground">Key stays in memory for this run. It is never saved or included in exports. Paste it again for another run.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1 text-sm">Fair band ±%<input className={field} type="number" min="0" max="50" step="0.1" required value={tolerance} onChange={(event) => setTolerance(event.target.value)} disabled={busy} /></label>
        <label className="block space-y-1 text-sm">Pages per item<select className={field} value={pages} onChange={(event) => setPages(event.target.value)} disabled={busy}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} />I agree to send public catalog and listing content to TypeSafe AI/Jev. API charges may apply.</label>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={usdConfirmed} onChange={(event) => setUsdConfirmed(event.target.checked)} disabled={busy} />I confirm this store and the eBay listings use USD prices.</label>
      {formError ? <p role="alert" className="text-sm text-red-600">{formError}</p> : null}
      <div className="flex gap-2"><button type="submit" disabled={busy || !consent || !usdConfirmed || !apiKey.trim()} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">Start audit</button>{busy ? <button type="button" onClick={stop} disabled={snapshot.status === "stopping"} className="rounded border px-3 py-2 text-sm disabled:opacity-50">Stop</button> : null}</div>
    </form>
    <p className="text-xs text-muted-foreground">Closing this panel or switching tools ends the scan. Export results before leaving. Comparisons need at least 3 confident unique sold matches and exclude shipping and tax. Search is capped at {runSettings?.maxSearchPages ?? pages} pages per item, not all historical eBay sales.</p>
    {snapshot.status !== "idle" ? <section className="space-y-2 rounded border border-border p-3 text-sm" aria-label="Audit progress">
      <p role="status" aria-live="polite">{snapshot.phase} · {snapshot.processed}/{snapshot.total} items · {snapshot.requests} Jev requests</p>
      <p>{snapshot.status === "complete" && snapshot.catalogComplete ? "Run complete within the search cap." : "Partial run or results still in progress."}</p>
      <p className="text-xs text-muted-foreground">{snapshot.catalogComplete ? "Public catalog traversal complete." : "Public catalog traversal is incomplete."} Available public variants only, not private inventory.</p>
      {snapshot.error ? <p role="alert" className="text-red-600">{snapshot.error}</p> : null}
    </section> : null}
    {snapshot.results.length > 0 ? <section className="space-y-3" aria-label="Price audit results">
      <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-sm">Show results<select className={field} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All ({snapshot.results.length})</option>{Object.entries(labels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><button type="button" onClick={exportResults} className="rounded border px-3 py-2 text-sm">Export JSON</button></div>
      {snapshot.results.filter((result) => filter === "all" || result.assessment.kind === filter).map((result) => <PriceAuditResult key={result.item.id} result={result} />)}
      {!snapshot.results.some((result) => filter === "all" || result.assessment.kind === filter) ? <p className="text-sm text-muted-foreground">No results in this category.</p> : null}
    </section> : null}
  </div></SidepanelLayout>;
}
