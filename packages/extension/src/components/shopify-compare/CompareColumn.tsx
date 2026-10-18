import { useState } from "react";
import { ArrowUpRight, Boxes, X } from "lucide-react";
import type { ShopifyProductDetails } from "../../domain/shopify-audit";
import { partitionListing, type DetailBlock } from "../../shopify-compare/listing";

export function formatMoney(amount: string | null, currencyCode: string | null): string | null {
  if (!amount) return null;
  if (!currencyCode) return amount;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(Number(amount));
  } catch {
    return `${currencyCode} ${amount}`;
  }
}

function priceRange(product: ShopifyProductDetails): string {
  const min = formatMoney(product.minPrice, product.currencyCode);
  const max = formatMoney(product.maxPrice, product.currencyCode);
  if (!min) return "No price";
  return max && max !== min ? `${min} – ${max}` : min;
}

function ListingBlock({ block }: { block: DetailBlock }) {
  switch (block.kind) {
    case "heading":
      return <h3>{block.text}</h3>;
    case "paragraph":
      return <p>{block.text}</p>;
    case "list":
      return <ul>{block.items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
    case "specifications":
      return (
        <table className="compare-specifications">
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}><th scope="row">{row.label}</th><td>{row.value}</td></tr>
            ))}
          </tbody>
        </table>
      );
  }
}

function Gallery({ images, title }: { images: string[]; title: string }) {
  const [index, setIndex] = useState(0);
  const image = images[Math.min(index, images.length - 1)];
  return (
    <div className="compare-gallery">
      <div className="compare-gallery-square">
        <span className="compare-gallery-placeholder"><Boxes aria-hidden="true" size={32} /> No photo</span>
        {image && <img alt={title} key={image} onError={(event) => { event.currentTarget.style.display = "none"; }} src={image} />}
      </div>
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

/**
 * One product as a vertical column, laid out like the Kiosk product popup.
 * Each child is a row of the parent subgrid, so sections line up across columns.
 */
export function CompareColumn({
  product,
  details,
  onRemove,
}: {
  product: ShopifyProductDetails;
  details: DetailBlock[];
  onRemove: () => void;
}) {
  const { conditionNotes, mainDetails } = partitionListing(details);
  const singleVariant = product.variants.length === 1 ? product.variants[0] : null;
  const inStock = product.totalInventory > 0;
  const facts: Array<[string, string | null]> = [
    ["Condition", product.condition],
    ["Status", product.status.toLowerCase()],
    ["Vendor", product.vendor],
    ["Type", product.productType],
  ];
  return (
    <article className="compare-column" aria-label={product.title}>
      <header className="compare-column-header">
        <h2 title={product.title}>{product.title}</h2>
        <div className="compare-column-actions">
          <a aria-label={`Open ${product.title} in Shopify`} href={product.url} rel="noopener noreferrer" target="_blank" title="Open in Shopify">
            <ArrowUpRight aria-hidden="true" size={16} />
          </a>
          <button aria-label={`Remove ${product.title} from comparison`} onClick={onRemove} title="Remove" type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      </header>

      <Gallery images={product.images} title={product.title} />

      <section className="compare-summary" aria-label="Price and availability">
        <p className="compare-price">{priceRange(product)}</p>
        <span className={inStock ? "compare-stock is-available" : "compare-stock"}>
          {inStock ? `${product.totalInventory} in stock` : "Out of stock"}
        </span>
        <dl className="compare-facts">
          {facts.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>
          ))}
        </dl>
      </section>

      <section className="compare-variants" aria-label="SKU and options">
        {singleVariant ? (
          <div className="compare-sku">
            <span>SKU</span>
            <strong>{singleVariant.sku || "Not provided"}</strong>
          </div>
        ) : (
          product.variants.map((variant) => (
            <div className="compare-variant" key={variant.id}>
              <h3>{variant.title}<span>{formatMoney(variant.price, product.currencyCode) ?? ""}</span></h3>
              <div className="compare-sku">
                <span>SKU</span>
                <strong>{variant.sku || "Not provided"}</strong>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="compare-listing compare-condition-notes" aria-label="Item condition">
        {conditionNotes.map((block, index) => <ListingBlock block={block} key={index} />)}
      </section>

      <section className="compare-listing" aria-label="Listing details">
        {mainDetails.length
          ? mainDetails.map((block, index) => <ListingBlock block={block} key={index} />)
          : <p className="compare-muted">No additional details provided.</p>}
      </section>
    </article>
  );
}
