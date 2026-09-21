import React, { useEffect, useRef, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { ArrowRight, Download, ScanSearch, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { runPriceAudit } from "../../price-audit/runner";
import { createRemoteAuditDecisions } from "../../price-audit/remote-decisions";
import type { AuditAssessment, AuditSettings, AuditSnapshot, ItemResult } from "../../price-audit/types";
import SidepanelLayout from "./SidepanelLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import "./price-audit.css";

const idle: AuditSnapshot = { status: "idle", phase: "Ready", total: 0, processed: 0, catalogComplete: false, results: [], error: null, startedAt: null, requests: 0 };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const labels: Record<AuditAssessment["kind"], string> = { high: "Too high", low: "Too low", fair: "Just right", insufficient: "Insufficient evidence" };
const badges: Record<AuditAssessment["kind"], string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  low: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  fair: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  insufficient: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
};
const field = "price-audit-field";

export function PriceAuditResult({ result }: { result: ItemResult }) {
  const { item, assessment, comparables } = result;
  return <article className="price-audit-result space-y-2 text-sm">
    <span className={`price-audit-badge ${badges[assessment.kind]}`}>{labels[assessment.kind]}</span>
    <h3 className="break-words font-semibold"><a href={item.url} target="_blank" rel="noreferrer" className="underline">{item.title}</a></h3>
    <p className="break-words text-xs text-muted-foreground">{item.variant}{item.sku ? ` · ${item.sku}` : ""}</p>
    <div className="price-audit-prices"><div><span className="price-audit-label">Store</span><p className="price-audit-amount">{money.format(item.priceCents / 100)} <small>USD</small></p></div>
    {assessment.kind !== "insufficient" ? <div><span className="price-audit-label">Sold median</span><p className="price-audit-amount price-audit-green">{money.format(assessment.medianCents / 100)} <small>USD</small></p></div> : null}</div>
    {assessment.kind === "insufficient" ? <p>{assessment.reason}</p> : <>
      <p>{assessment.differencePercent > 0 ? "+" : ""}{assessment.differencePercent.toFixed(1)}% vs. sold median</p>
      <p className="text-xs text-muted-foreground">Fair band: {money.format(assessment.lowCents / 100)}–{money.format(assessment.highCents / 100)}</p>
    </>}
    <details className="price-audit-evidence">
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
  const convex = useConvex();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [storeUrl, setStoreUrl] = useState("");
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
    if (!isLoading && !isAuthenticated) controller.current?.abort();
  }, [isLoading, isAuthenticated]);

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
    if (isLoading || !isAuthenticated) {
      setFormError("Sign in using the account control to start an audit.");
      return;
    }
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
    if (!consent || !usdConfirmed) {
      setFormError("Confirm both checkboxes before starting.");
      return;
    }
    const activeController = new AbortController();
    controller.current = activeController;
    const settings = { storeUrl: normalizedUrl.origin, tolerancePercent, maxSearchPages };
    setRunSettings(settings);
    setSnapshot({ ...idle, status: "running", phase: "Starting", startedAt: new Date().toISOString() });
    let requests = 0;
    const decisions = createRemoteAuditDecisions(convex, () => {
      requests++;
      if (mounted.current && controller.current === activeController) setSnapshot((previous) => ({ ...previous, requests }));
    });
    try {
      await runPriceAudit({ settings, decisions, signal: activeController.signal, onUpdate: (next) => {
        if (mounted.current && controller.current === activeController) setSnapshot({ ...next, requests });
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

  return <SidepanelLayout className="price-audit-root"><div className="price-audit-content">
    <header className="price-audit-intro"><div className="price-audit-icon"><ScanSearch size={20} aria-hidden="true" /></div><div><h2>Shopify price audit</h2><p>Compare your store with real eBay sales.</p></div></header>
    <form onSubmit={start} className="price-audit-form">
      <label className="block space-y-2 text-sm font-semibold">Shopify store URL<Input className={field} type="url" required placeholder="https://your-store.com" value={storeUrl} onChange={(event) => setStoreUrl(event.target.value)} disabled={busy} /></label>
      <details className="price-audit-options"><summary><SlidersHorizontal size={14} aria-hidden="true" /><span>Comparison settings</span><span className="price-audit-settings-summary">±{tolerance}% · {pages} pages</span></summary><div className="grid grid-cols-2 gap-3 pt-3">
        <label className="block space-y-1 text-xs font-semibold">Fair band ±%<Input className={field} type="number" min="0" max="50" step="0.1" required value={tolerance} onChange={(event) => setTolerance(event.target.value)} disabled={busy} /></label>
        <label className="block space-y-1 text-sm">Pages per item<select className={field} value={pages} onChange={(event) => setPages(event.target.value)} disabled={busy}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div></details>
      <label className="price-audit-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} />I agree to send public catalog and listing evidence to TypeSafe via Volt.</label>
      <label className="price-audit-consent"><input type="checkbox" checked={usdConfirmed} onChange={(event) => setUsdConfirmed(event.target.checked)} disabled={busy} />I confirm this store and the eBay listings use USD prices.</label>
      {formError ? <p role="alert" className="text-sm text-red-600">{formError}</p> : null}
      {!isAuthenticated ? <p className="price-audit-account" role="status">{isLoading ? "Checking your account…" : "Sign in using the account control to start an audit."}</p> : null}
      <div className="flex gap-2"><Button type="submit" disabled={busy || isLoading || !isAuthenticated || !consent || !usdConfirmed || !storeUrl.trim()} className="price-audit-start">{busy ? "Audit in progress" : "Start audit"}<ArrowRight size={15} aria-hidden="true" /></Button>{busy ? <Button type="button" variant="outline" onClick={stop} disabled={snapshot.status === "stopping"} className="price-audit-stop">Stop</Button> : null}</div>
    </form>
    <div className="price-audit-disclosure"><ShieldCheck size={15} aria-hidden="true" /><p>Read-only. No store prices are changed. Comparisons need at least 3 confident unique sold matches and exclude shipping and tax.</p></div>
    <details className="price-audit-limits"><summary>Coverage & session limits</summary><p>Closing this panel or switching tools ends the scan. An already-running server request may still finish. Export results before leaving. Search is capped at {runSettings?.maxSearchPages ?? pages} pages per item, not all historical eBay sales. Only available public Shopify variants are scanned, not private inventory. Server safety limits allow 120 Jev requests per minute and 4,000 per day per account, including retries, with a shared daily cap.</p></details>
    {snapshot.status !== "idle" ? <section className="price-audit-progress space-y-2 text-sm" aria-label="Audit progress">
      <p role="status" aria-live="polite">{snapshot.phase} · {snapshot.processed}/{snapshot.total} items · {snapshot.requests} decision batches</p>
      <progress className="price-audit-progress-bar" aria-label="Items checked" max={Math.max(1, snapshot.total)} value={snapshot.processed} />
      <p>{snapshot.status === "complete" && snapshot.catalogComplete ? "Run complete within the search cap." : "Partial run or results still in progress."}</p>
      <p className="text-xs text-muted-foreground">{snapshot.catalogComplete ? "Public catalog traversal complete." : "Public catalog traversal is incomplete."} Available public variants only, not private inventory.</p>
      {snapshot.error ? <p role="alert" className="text-red-600">{snapshot.error}</p> : null}
    </section> : null}
    {snapshot.results.length > 0 ? <section className="space-y-3" aria-label="Price audit results">
      <div className="flex items-end gap-2"><label className="min-w-0 flex-1 space-y-1 text-xs font-semibold">Show results<select className={field} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All ({snapshot.results.length})</option>{Object.entries(labels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><Button type="button" variant="outline" onClick={exportResults} className="price-audit-export"><Download size={14} aria-hidden="true" />Export JSON</Button></div>
      {snapshot.results.filter((result) => filter === "all" || result.assessment.kind === filter).map((result) => <PriceAuditResult key={result.item.id} result={result} />)}
      {!snapshot.results.some((result) => filter === "all" || result.assessment.kind === filter) ? <p className="text-sm text-muted-foreground">No results in this category.</p> : null}
    </section> : null}
  </div></SidepanelLayout>;
}
