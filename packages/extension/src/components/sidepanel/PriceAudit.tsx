import React, { useEffect, useRef, useState } from "react";
import { useConvex, useConvexAuth } from "convex/react";
import { ArrowRight, Download, ScanSearch, Settings } from "lucide-react";
import { runPriceAudit } from "../../price-audit/runner";
import { createRemoteAuditDecisions } from "../../price-audit/remote-decisions";
import { storeOrigin } from "../../price-audit/catalog";
import { DEFAULT_PRICE_AUDIT_SETTINGS, mergePriceAuditSettings } from "../../domain/settings";
import type { CmdkSettings, SyncStorageChanges, SyncStorageResult } from "../../types/settings";
import type { AuditAssessment, AuditSettings, AuditSnapshot, ItemResult } from "../../price-audit/types";
import SidepanelLayout from "./SidepanelLayout";
import { useSidepanelSignedIn } from "../access/ExtensionAccess";
import { Button } from "../ui/button";
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
type SavedAuditSettings = NonNullable<CmdkSettings["priceAudit"]>;
const emptySettings: SavedAuditSettings = { ...DEFAULT_PRICE_AUDIT_SETTINGS };

export function configuredAudit(settings: SavedAuditSettings): AuditSettings | null {
  if (settings.consentToProvider !== true || settings.usdConfirmed !== true || !Number.isFinite(settings.tolerancePercent) || settings.tolerancePercent < 0 || settings.tolerancePercent > 50 || !Number.isInteger(settings.maxSearchPages) || settings.maxSearchPages < 1 || settings.maxSearchPages > 5) return null;
  try { return { storeUrl: storeOrigin(settings.storeUrl), tolerancePercent: settings.tolerancePercent, maxSearchPages: settings.maxSearchPages }; } catch { return null; }
}

function openSettings() {
  if (typeof chrome !== "undefined") void chrome.runtime.sendMessage({ action: "open-settings", section: "priceaudit" });
}

export function PriceAuditStore({ settings }: { settings: SavedAuditSettings }) {
  return <div className="price-audit-store"><div className="min-w-0"><span className="price-audit-label">Shopify store</span><p className="break-words text-sm font-semibold">{settings.storeUrl || "No store configured"}</p></div><Button type="button" variant="ghost" size="sm" onClick={openSettings} aria-label="Open price audit settings"><Settings size={16} aria-hidden="true" /><span>Settings</span></Button></div>;
}

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
          <p className="text-muted-foreground">Jev match probability: {Math.round(comparable.matchProbability * 100)}%</p>
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
  const signedIn = useSidepanelSignedIn();
  const accountMessage = isLoading
    ? "Checking your account…"
    : signedIn
      ? "You're signed in, but the server connection needs a refresh. Refresh the extension and try again."
      : "Sign in using the account control to start an audit.";
  const [savedSettings, setSavedSettings] = useState<SavedAuditSettings>(emptySettings);
  const [snapshot, setSnapshot] = useState<AuditSnapshot>(idle);
  const [runSettings, setRunSettings] = useState<AuditSettings | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const downloadUrl = useRef<string | null>(null);
  const busy = snapshot.status === "running" || snapshot.status === "stopping";
  const configured = configuredAudit(savedSettings);
  const savedSignature = useRef(JSON.stringify(emptySettings));

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    let active = true;
    let receivedChange = false;
    const apply = (value: CmdkSettings | undefined) => {
      if (!active) return;
      const next = mergePriceAuditSettings(value?.priceAudit);
      const signature = JSON.stringify(next);
      if (signature !== savedSignature.current) {
        controller.current?.abort();
        savedSignature.current = signature;
        setSavedSettings(next);
        setFormError(null);
      }
    };
    const changed = (changes: SyncStorageChanges, areaName: string) => {
      if (areaName === "sync" && changes.cmdkSettings) {
        receivedChange = true;
        apply(changes.cmdkSettings.newValue);
      }
    };
    chrome.storage.onChanged.addListener(changed);
    chrome.storage.sync.get(["cmdkSettings"], (value: SyncStorageResult) => { if (!receivedChange) apply(value.cmdkSettings); });
    return () => { active = false; chrome.storage.onChanged.removeListener(changed); };
  }, []);

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

  async function start() {
    if (controller.current) return;
    setFormError(null);
    if (isLoading || !isAuthenticated) {
      setFormError(accountMessage);
      return;
    }
    const settings = configuredAudit(savedSettings);
    if (!settings) {
      setFormError("Finish price audit setup in Settings to start.");
      return;
    }
    const activeController = new AbortController();
    controller.current = activeController;
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
    <div className="price-audit-form">
      <PriceAuditStore settings={savedSettings} />
      {formError ? <p role="alert" className="text-sm text-red-600">{formError}</p> : null}
      {!isAuthenticated ? <p className="price-audit-account" role="status">{accountMessage}</p> : null}
      {isAuthenticated && !configured && !formError ? <p className="text-xs text-muted-foreground">Finish price audit setup in Settings to start.</p> : null}
      <div className="flex gap-2"><Button type="button" onClick={start} disabled={busy || isLoading || !isAuthenticated || !configured} className="price-audit-start">{busy ? "Audit in progress" : "Start audit"}<ArrowRight size={15} aria-hidden="true" /></Button>{busy ? <Button type="button" variant="outline" onClick={stop} disabled={snapshot.status === "stopping"} className="price-audit-stop">Stop</Button> : null}</div>
    </div>
    {snapshot.status !== "idle" ? <section className="price-audit-progress space-y-2 text-sm" aria-label="Audit progress">
      <p role="status" aria-live="polite">{snapshot.phase} · {snapshot.processed}/{snapshot.total} items · {snapshot.requests} decision batches</p>
      <progress className="price-audit-progress-bar" aria-label="Items checked" max={Math.max(1, snapshot.total)} value={snapshot.processed} />
      <p>{snapshot.status === "complete" && snapshot.catalogComplete ? "Run complete within the search cap." : "Partial run or results still in progress."}</p>
      <p className="text-xs text-muted-foreground">{snapshot.catalogComplete ? "Catalog scan complete." : "Catalog scan is incomplete."}</p>
      {snapshot.error ? <p role="alert" className="text-red-600">{snapshot.error}</p> : null}
    </section> : null}
    {snapshot.results.length > 0 ? <section className="space-y-3" aria-label="Price audit results">
      <div className="flex items-end gap-2"><label className="min-w-0 flex-1 space-y-1 text-xs font-semibold">Show results<select className={field} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All ({snapshot.results.length})</option>{Object.entries(labels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><Button type="button" variant="outline" onClick={exportResults} className="price-audit-export"><Download size={14} aria-hidden="true" />Export JSON</Button></div>
      {snapshot.results.filter((result) => filter === "all" || result.assessment.kind === filter).map((result) => <PriceAuditResult key={result.item.id} result={result} />)}
      {!snapshot.results.some((result) => filter === "all" || result.assessment.kind === filter) ? <p className="text-sm text-muted-foreground">No results in this category.</p> : null}
    </section> : null}
  </div></SidepanelLayout>;
}
