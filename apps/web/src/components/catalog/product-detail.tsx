import { useState } from "react";
import { Check, Copy, ExternalLink, ImageOff, LoaderCircle, PackageSearch } from "lucide-react";

import {
  catalogCollections,
  catalogDate,
  catalogFacts,
  catalogSummary,
  safeCatalogUrl,
  type CatalogProduct,
} from "../../lib/catalog";

const actionClass = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:border-emerald-500 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500";

export function ProductDetail({ product }: { product: CatalogProduct | null | undefined }) {
  if (product === undefined) {
    return (
      <div role="status" className="flex min-h-64 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        Loading product details
      </div>
    );
  }
  if (product === null) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center">
        <PackageSearch aria-hidden="true" className="mx-auto size-7 text-zinc-300" />
        <h3 className="mt-3 text-sm font-semibold text-zinc-950">Product details unavailable</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-500">Select another product or retry the search.</p>
      </div>
    );
  }
  return <ProductResearch key={product.upc} product={product} />;
}

function ProductResearch({ product }: { product: CatalogProduct }) {
  const [copyStatus, setCopyStatus] = useState<{ kind: "success" | "error"; label: string } | null>(null);
  const facts = catalogFacts(product).filter(({ label }) =>
    label !== "UPC" && label !== "MPN" && label !== "Additional UPCs",
  );
  const collections = catalogCollections(product);
  const otherUpcs = [...new Set(product.upcs)].filter((upc) => upc !== product.upc);
  const images = [...new Set(product.listings.flatMap((listing) => {
    const url = safeCatalogUrl(listing.imageUrl);
    return url ? [url] : [];
  }))];
  const sources = new Map<string, number | undefined>();
  for (const listing of product.listings) {
    const url = safeCatalogUrl(listing.sourceUrl);
    if (url) {
      const previous = sources.get(url);
      sources.set(url, previous === undefined ? listing.updatedAt : Math.max(previous, listing.updatedAt ?? previous));
    }
  }
  for (const source of product.sourceUrls) {
    const url = safeCatalogUrl(source);
    if (url && !sources.has(url)) sources.set(url, undefined);
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus({ kind: "success", label });
    } catch {
      setCopyStatus({ kind: "error", label });
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <ProductGallery images={images} title={product.title} />
      <div className="space-y-6 p-5 sm:p-6">
        <header>
          {collections.length > 0 ? (
            <ul aria-label="Collections" className="flex flex-wrap gap-1.5">
              {collections.map((collection) => (
                <li key={collection} className="rounded-full bg-emerald-50 px-2.5 py-1 text-[0.68rem] font-semibold text-emerald-800">{collection}</li>
              ))}
            </ul>
          ) : null}
          <h3 className="mt-3 break-words text-lg font-semibold leading-7 tracking-tight text-zinc-950">{product.title}</h3>
          <p className="mt-1 text-xs text-zinc-500">Catalog updated {catalogDate(product.updatedAt)}</p>
        </header>

        <section aria-label="Product identifiers" className="space-y-3">
          <Identifier label="UPC" value={product.upc} copy={copy} />
          {product.mpn ? (
            <Identifier label="MPN" value={product.mpn} copy={copy} />
          ) : null}
          {otherUpcs.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold text-zinc-600">Also indexed under</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {otherUpcs.map((upc) => (
                  <button key={upc} type="button" className={actionClass} aria-label={`Copy UPC ${upc}`} onClick={() => void copy("UPC", upc)}>
                    <span className="font-mono">{upc}</span>
                    <Copy aria-hidden="true" className="size-3" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={actionClass} onClick={() => void copy("Title", product.title)}>
              <Copy aria-hidden="true" className="size-3.5" />Copy title
            </button>
            <button type="button" className={actionClass} onClick={() => void copy("Spec summary", catalogSummary(product))}>
              <Copy aria-hidden="true" className="size-3.5" />Copy spec summary
            </button>
          </div>
          <p role="status" aria-live="polite" className={`min-h-4 text-xs ${copyStatus?.kind === "error" ? "text-red-700" : "text-emerald-700"}`}>
            {copyStatus?.kind === "success" ? (
              <span className="inline-flex items-center gap-1">
                <Check aria-hidden="true" className="size-3" />{copyStatus.label} copied
              </span>
            ) : copyStatus?.kind === "error" ? (
              `Could not copy ${copyStatus.label.toLowerCase()}. Select and copy the text manually.`
            ) : null}
          </p>
        </section>

        <section aria-labelledby={`specifications-${product.upc}`}>
          <h4 id={`specifications-${product.upc}`} className="text-sm font-semibold text-zinc-950">Specifications</h4>
          {facts.length > 0 ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl bg-zinc-50 p-4">
              {facts.map(({ label, value }) => (
                <div key={label} className="min-w-0">
                  <dt className="break-words text-[0.65rem] font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-800">{value}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="mt-2 text-xs leading-5 text-zinc-500">No specifications have been imported for this product.</p>}
        </section>

        <section aria-labelledby={`sources-${product.upc}`}>
          <h4 id={`sources-${product.upc}`} className="text-sm font-semibold text-zinc-950">Source listings <span className="font-normal text-zinc-400">{sources.size}</span></h4>
          <p className="mt-1 text-xs leading-5 text-zinc-500">Reference data only. Check the source for current price, condition, and availability.</p>
          {sources.size > 0 ? (
            <ul className="mt-3 max-h-80 overflow-y-auto divide-y divide-zinc-100 rounded-xl border border-zinc-200">
              {[...sources].map(([url, updatedAt]) => (
                <SourceListing key={url} url={url} updatedAt={updatedAt} />
              ))}
            </ul>
          ) : <p className="mt-3 text-xs text-zinc-500">No source links available.</p>}
        </section>

        <section aria-label="External research">
          <h4 className="text-sm font-semibold text-zinc-950">Continue research</h4>
          <p className="mt-1 text-xs leading-5 text-zinc-500">Search by exact UPC. Results open in a new tab and may include other products.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className={actionClass} href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(product.upc)}&LH_Sold=1&LH_Complete=1`} target="_blank" rel="noopener noreferrer">
              eBay sold results <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
            <a className={actionClass} href={`https://www.google.com/search?q=${encodeURIComponent(`"${product.upc}"`)}`} target="_blank" rel="noopener noreferrer">
              Google UPC <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </div>
        </section>
      </div>
    </article>
  );
}

function Identifier({ label, value, copy }: {
  label: string;
  value: string;
  copy: (label: string, value: string) => Promise<void>;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 p-3">
      <div className="min-w-0">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="break-all font-mono text-sm text-zinc-900">{value}</p>
      </div>
      <button type="button" className={actionClass} aria-label={`Copy ${label}`} onClick={() => void copy(label, value)}>
        <Copy aria-hidden="true" className="size-3.5" />Copy
      </button>
    </div>
  );
}

function SourceListing({ url, updatedAt }: { url: string; updatedAt: number | undefined }) {
  const source = new URL(url);
  return (
    <li>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start justify-between gap-3 p-3 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
      >
        <span className="min-w-0">
          <span className="block break-all text-xs font-semibold text-zinc-800">{source.hostname}</span>
          <span className="mt-1 block break-all text-[0.65rem] text-zinc-500">{source.pathname}{source.search}</span>
          <span className="mt-1 block text-[0.65rem] text-zinc-500">{updatedAt === undefined ? "Import date unavailable" : `Imported ${catalogDate(updatedAt)}`}</span>
        </span>
        <ExternalLink aria-label="Opens in a new tab" className="mt-0.5 size-3.5 shrink-0 text-zinc-400" />
      </a>
    </li>
  );
}

function ProductGallery({ images, title }: { images: string[]; title: string }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const activeIndex = Math.min(selectedIndex, Math.max(images.length - 1, 0));
  const selected = images[activeIndex];
  return (
    <section aria-label="Product photos" className="border-b border-zinc-100 bg-zinc-50 p-4">
      <div className="flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl bg-white">
        {selected && !failedImages.has(selected) ? (
          <img
            src={selected}
            alt={`${title}, photo ${activeIndex + 1}`}
            className="size-full object-contain p-3"
            referrerPolicy="no-referrer"
            onError={() => setFailedImages((failed) => new Set(failed).add(selected))}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-xs text-zinc-400">
            <ImageOff aria-hidden="true" className="size-8" />
            {selected ? "Photo could not be loaded" : "No product photos"}
          </div>
        )}
      </div>
      {images.length > 1 ? (
        <div className="mt-3 flex max-h-28 flex-wrap items-center gap-2 overflow-y-auto" aria-label="Choose product photo">
          {images.map((url, index) => (
            <button
              key={url}
              type="button"
              aria-label={`View photo ${index + 1}`}
              aria-pressed={index === activeIndex}
              onClick={() => setSelectedIndex(index)}
              className={`grid size-9 place-items-center rounded-lg border text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${activeIndex === index
                ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"}`}
            >
              {index + 1}
            </button>
          ))}
          <span className="text-xs text-zinc-500">{images.length} source photos</span>
        </div>
      ) : null}
    </section>
  );
}
