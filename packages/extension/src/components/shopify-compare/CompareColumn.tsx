import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Boxes, Check, ChevronLeft, ChevronRight, Copy, X } from "lucide-react";
import type { DetailBlock } from "../../shopify-compare/listing";
import type { CompareItem, CompareRow } from "../../shopify-compare/compare-model";

export function formatMoney(amount: string | null, currencyCode: string | null): string | null {
  if (!amount) return null;
  if (!currencyCode) return amount;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(Number(amount));
  } catch {
    return `${currencyCode} ${amount}`;
  }
}

function priceRange(product: CompareItem["product"]): string {
  const min = formatMoney(product.minPrice, product.currencyCode);
  const max = formatMoney(product.maxPrice, product.currencyCode);
  if (!min) return "No price";
  return max && max !== min ? `${min} – ${max}` : min;
}

function ListingBlock({ block }: { block: DetailBlock }) {
  switch (block.kind) {
    case "heading":
      return <h4>{block.text.replace(/\s*:\s*$/, "")}</h4>;
    case "paragraph":
      return <p>{block.text}</p>;
    case "list":
      return <ul>{block.items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
    case "specifications":
      return (
        <dl className="compare-inline-specs">
          {block.rows.map((row, index) => <div key={index}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
        </dl>
      );
  }
}

/** The photos full screen: arrows or arrow keys to move, Esc or a click outside to close. */
export function Lightbox({ images, index, title, onIndex, onClose }: {
  images: string[];
  index: number;
  title: string;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const count = images.length;
  const step = (delta: number) => onIndex((index + delta + count) % count);
  const dialog = useRef<HTMLDivElement | null>(null);
  // Focus moves into the viewer and comes back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>(".is-close")?.focus();
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && count > 1) onIndex((index - 1 + count) % count);
      else if (event.key === "ArrowRight" && count > 1) onIndex((index + 1) % count);
      else if (event.key === "Tab") {
        // Keep Tab inside the viewer while it covers the page.
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button") ?? []);
        const at = buttons.indexOf(document.activeElement as HTMLElement);
        buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, index, onClose, onIndex]);
  return createPortal(
    <div aria-label={`${title} photos`} aria-modal="true" className="compare-lightbox" onClick={onClose} ref={dialog} role="dialog">
      <img alt={`${title}, photo ${index + 1} of ${count}`} onClick={(event) => event.stopPropagation()} src={images[index]} />
      <button aria-label="Close photos" className="compare-lightbox-button is-close" onClick={onClose} type="button"><X aria-hidden="true" size={20} /></button>
      {count > 1 && <>
        <button aria-label="Previous photo" className="compare-lightbox-button is-previous" onClick={(event) => { event.stopPropagation(); step(-1); }} type="button"><ChevronLeft aria-hidden="true" size={22} /></button>
        <button aria-label="Next photo" className="compare-lightbox-button is-next" onClick={(event) => { event.stopPropagation(); step(1); }} type="button"><ChevronRight aria-hidden="true" size={22} /></button>
        <span className="compare-lightbox-count">{index + 1} / {count}</span>
      </>}
    </div>,
    document.body,
  );
}

function Gallery({ images, title }: { images: string[]; title: string }) {
  const [index, setIndex] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const position = Math.min(index, images.length - 1);
  const image = images[position];
  return (
    <div className="compare-cell compare-gallery">
      <div className="compare-gallery-frame">
        <span className="compare-gallery-placeholder"><Boxes aria-hidden="true" size={28} /> No photo</span>
        {image && <img alt={title} key={image} onError={(event) => { event.currentTarget.style.display = "none"; }} src={image} />}
        {image && <button aria-label={`Enlarge photo of ${title}`} className="compare-gallery-zoom" onClick={() => setEnlarged(true)} title="Enlarge photo" type="button" />}
      </div>
      {enlarged && image && <Lightbox images={images} index={position} onClose={() => setEnlarged(false)} onIndex={setIndex} title={title} />}
      {images.length > 1 && (
        <div className="compare-gallery-thumbnails" aria-label={`${title} photos`}>
          {images.map((url, position) => (
            <button
              aria-label={`Photo ${position + 1} of ${images.length}`}
              aria-pressed={url === image}
              className="compare-gallery-thumbnail"
              key={url}
              onClick={() => setIndex(position)}
              type="button"
            >
              <img alt="" loading="lazy" src={url} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CopySku({ sku }: { sku: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!sku) return <span className="compare-sku is-missing">No SKU</span>;
  const copy = () => {
    void navigator.clipboard.writeText(sku).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }, () => undefined);
  };
  return (
    <button aria-label={`Copy SKU ${sku}`} className="compare-sku" onClick={copy} title="Copy SKU" type="button">
      <span>{sku}</span>
      {copied ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
    </button>
  );
}

function AttributeRow({ row, index }: { row: CompareRow; index: number }) {
  const value = row.values[index];
  return (
    <div className={row.differs ? "compare-cell compare-attribute is-different" : "compare-cell compare-attribute"}>
      <span className="compare-attribute-label">{row.label}</span>
      <span className={value ? "compare-attribute-value" : "compare-attribute-value is-empty"}>{value || "—"}</span>
    </div>
  );
}

/**
 * One product as a vertical column, laid out like the Kiosk product popup.
 * Each child is a row of the parent subgrid (see compareRowCount), so every
 * attribute lines up with the same attribute of the other products.
 */
export function CompareColumn({
  item,
  index,
  facts,
  specs,
  hasNotes,
  hasDetails,
  onRemove,
}: {
  item: CompareItem;
  index: number;
  facts: CompareRow[];
  specs: CompareRow[];
  hasNotes: boolean;
  hasDetails: boolean;
  onRemove: () => void;
}) {
  const { product, conditionNotes, otherDetails, isLowestPrice } = item;
  const singleVariant = product.variants.length === 1 ? product.variants[0] : null;
  const inStock = product.totalInventory > 0;
  return (
    <article className="compare-column" aria-label={product.title}>
      <header className="compare-cell compare-column-header">
        <span className="compare-column-thumb" aria-hidden="true">{product.images[0] && <img alt="" src={product.images[0]} />}</span>
        <h2 title={product.title}>{product.title}</h2>
        <div className="compare-column-actions">
          <a aria-label={`Open ${product.title} in Shopify`} href={product.url} rel="noopener noreferrer" target="_blank" title="Open in Shopify">
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
          <button aria-label={`Remove ${product.title} from comparison`} onClick={onRemove} title="Remove" type="button">
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      </header>

      <Gallery images={product.images} title={product.title} />

      <section className="compare-cell compare-price-cell" aria-label="Price and availability">
        <p className="compare-price">{priceRange(product)}</p>
        <div className="compare-badges">
          <span className={inStock ? "compare-badge is-available" : "compare-badge is-unavailable"}>
            {inStock ? `${product.totalInventory} in stock` : "Out of stock"}
          </span>
          {isLowestPrice && <span className="compare-badge is-best">Lowest price</span>}
        </div>
      </section>

      {facts.map((row) => <AttributeRow index={index} key={row.label} row={row} />)}

      <section className="compare-cell compare-section" aria-label="SKU and options">
        <h3 className="compare-section-label">{singleVariant ? "SKU" : "Variants"}</h3>
        {singleVariant ? (
          <CopySku sku={singleVariant.sku} />
        ) : (
          <ul className="compare-variants">
            {product.variants.map((variant) => (
              <li key={variant.id}>
                <span className="compare-variant-title">{variant.title}</span>
                <span className="compare-variant-price">{formatMoney(variant.price, product.currencyCode) ?? "—"}</span>
                <CopySku sku={variant.sku} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {hasDetails && (
        <section className="compare-cell compare-section compare-listing" aria-label="Listing details">
          <h3 className="compare-section-label">Listing details</h3>
          {otherDetails.length
            ? otherDetails.map((block, position) => <ListingBlock block={block} key={position} />)
            : <p className="compare-muted">No additional details provided.</p>}
        </section>
      )}

      {specs.length > 0 && <h3 className="compare-cell compare-section-label compare-specs-heading">Specifications</h3>}
      {specs.map((row) => <AttributeRow index={index} key={row.label} row={row} />)}

      {hasNotes && (
        <section className="compare-cell compare-section compare-listing" aria-label="Item condition">
          <h3 className="compare-section-label">Condition notes</h3>
          {conditionNotes.length
            ? <div className="compare-notes">{conditionNotes.map((block, position) => <ListingBlock block={block} key={position} />)}</div>
            : <p className="compare-muted">No condition notes.</p>}
        </section>
      )}
    </article>
  );
}
