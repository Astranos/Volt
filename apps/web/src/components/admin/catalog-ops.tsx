import { useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const reasonLabels = {
  source_upc_changed: "Source UPC changed",
  variant_conflict: "Variant details conflict",
  possible_upc_alias: "Possible UPC alias",
} as const;

export function CatalogOps() {
  const importRun = useQuery(api.catalogImport.status, {});
  const [cursor, setCursor] = useState<string | null>(null);
  const pending = useQuery(api.catalogReview.listPending, {
    paginationOpts: { numItems: 25, cursor },
  });
  const [selectedId, setSelectedId] = useState<Id<"catalogObservations"> | null>(null);
  const selected = useQuery(
    api.catalogReview.getCandidate,
    selectedId ? { id: selectedId } : "skip",
  );
  const resolve = useMutation(api.catalogReview.resolve);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "accept" | "reject") {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resolve({ id: selectedId, decision });
      setSelectedId(null);
      setCursor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the decision");
    } finally {
      setBusy(false);
    }
  }

  const completed = importRun?.collections.filter((collection) => collection.done).length ?? 0;
  const pages = importRun?.collections.reduce((total, collection) => total + collection.pagesDone, 0) ?? 0;
  const items = importRun?.collections.reduce((total, collection) => total + collection.itemsSeen, 0) ?? 0;

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold">Catalog import</h2>
        {importRun === undefined ? (
          <p className="mt-2 text-sm text-zinc-500">Loading import status…</p>
        ) : importRun === null ? (
          <p className="mt-2 text-sm text-zinc-500">No import has run yet.</p>
        ) : (
          <div className="mt-3 grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
            <p>Status: <strong className="capitalize">{importRun.status}</strong></p>
            <p>Collections: {completed} of {importRun.collections.length} complete</p>
            <p>Pages committed: {pages.toLocaleString()}</p>
            <p>Items seen: {items.toLocaleString()}</p>
            <p>Started: {new Date(importRun.startedAt).toLocaleString()}</p>
            <p>{importRun.fullImport ? "Full source run" : "Selected collections"}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold">UPC review queue</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Check the source and product details before approving an identity change.
        </p>
        {pending === undefined ? (
          <p className="mt-4 text-sm text-zinc-500">Loading review candidates…</p>
        ) : pending.page.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No candidates on this page.</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100 border-y border-zinc-100">
            {pending.page.map((row) => (
              <li key={row.id} className="py-3">
                <button
                  type="button"
                  onClick={() => { setSelectedId(row.id); setError(null); }}
                  className="w-full text-left hover:text-emerald-700"
                >
                  <span className="block truncate text-sm font-medium">{row.title}</span>
                  <span className="block text-xs text-zinc-500">
                    {row.observedUpc} · {reasonLabels[row.reason]}
                    {row.classification ? ` · Model: ${row.classification.verdict}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {pending && (cursor !== null || !pending.isDone) ? (
          <div className="mt-4 flex gap-3">
            {cursor !== null ? (
              <button type="button" onClick={() => { setCursor(null); setSelectedId(null); }} className="text-sm font-semibold text-zinc-700 underline">
                First page
              </button>
            ) : null}
            {!pending.isDone ? (
              <button type="button" onClick={() => { setCursor(pending.continueCursor); setSelectedId(null); }} className="text-sm font-semibold text-emerald-700 underline">
                Next page
              </button>
            ) : null}
          </div>
        ) : null}

        {selectedId && selected === undefined ? (
          <p className="mt-5 text-sm text-zinc-500">Loading candidate…</p>
        ) : selected ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <h3 className="font-semibold text-zinc-950">{selected.candidate.title}</h3>
            <p className="mt-1 text-zinc-700">{reasonLabels[selected.reason]} · UPC {selected.observedUpc}</p>
            <dl className="mt-3 grid gap-2 text-zinc-700 sm:grid-cols-2">
              {(["brand", "model", "mpn", "platform", "edition", "color", "storage"] as const).map((key) =>
                selected.candidate[key] ? (
                  <div key={key}><dt className="inline capitalize">{key}: </dt><dd className="inline font-medium">{selected.candidate[key]}</dd></div>
                ) : null,
              )}
            </dl>
            <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 block break-all font-medium text-emerald-700 underline">
              Open source listing
            </a>
            {selected.classification ? (
              <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 text-zinc-700">
                <p className="font-medium">Model assessment: {selected.classification.verdict}</p>
                <ul className="mt-1 list-inside list-disc">
                  {selected.classification.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy || !selected.active} onClick={() => void decide("accept")} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
                Accept UPC claim
              </button>
              <button type="button" disabled={busy || !selected.active} onClick={() => void decide("reject")} className="rounded-lg border border-red-300 px-4 py-2 font-semibold text-red-700 disabled:opacity-50">
                Reject claim
              </button>
            </div>
            {!selected.active ? <p className="mt-2 text-zinc-600">This source is no longer active.</p> : null}
            {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
