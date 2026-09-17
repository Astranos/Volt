import { Dialog } from "@base-ui/react/dialog";
import { ScrollArea } from '@base-ui/react/scroll-area';
import { X } from "lucide-react";
import type { DetailBlock, Product } from "../catalog";
import { money, productPrice } from "../browse";
import { ProductGallery } from "./ProductGallery";
import { partitionListing } from "./listing-layout";
import { RequestButton } from './RequestButton';
import "./product-detail.css";
import './popup-scroll.css';

function ListingBlock({ block }: { block: DetailBlock }) {
  switch (block.kind) {
    case "heading":
      return <h3>{block.text}</h3>;
    case "paragraph":
      return <p>{block.text}</p>;
    case "list":
      return (
        <ul>
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    case "specifications":
      return (
        <table className="specifications-table">
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                <th scope="row">{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}
function ItemSku({ sku, storeSlug, visitorId, productId, variantId, enabled }: { sku: string | null; storeSlug: string; visitorId: string; productId: string; variantId: string; enabled: boolean }) {
  return (
    <div className="item-sku">
      <span>SKU</span>
      <strong>{sku || "Not provided"}</strong>
      {sku && <small>Give this SKU to an associate.</small>}
      <RequestButton key={`${visitorId}:${variantId}`} storeSlug={storeSlug} visitorId={visitorId} productId={productId} variantId={variantId} enabled={enabled} />
    </div>
  );
}
export function ProductDetail({
  product,
  available,
  storeSlug,
  visitorId,
  onClose,
}: {
  product: Product;
  available: boolean;
  storeSlug: string;
  visitorId: string;
  onClose: () => void;
}) {
  const singleVariant =
    product.variants.length === 1 ? product.variants[0] : null;
  const { conditionNotes, mainDetails } = partitionListing(product.details);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="product-dialog scrollable-product-dialog">
          <ScrollArea.Root className="product-scroll-area">
            <ScrollArea.Viewport className="product-scroll-viewport" aria-label="Product information" role="region">
              <ScrollArea.Content className="product-scroll-content">
          <div className="dialog-top">
            <Dialog.Close className="button secondary">
              <X size={20} /> Close
            </Dialog.Close>
          </div>
          <div className="detail-layout">
            <div className="detail-media">
              <ProductGallery images={product.images} title={product.title} />
              {conditionNotes.length > 0 && (
                <section className="listing-content condition-notes" aria-label="Item condition">
                  {conditionNotes.map((block, index) => (
                    <ListingBlock key={index} block={block} />
                  ))}
                </section>
              )}
            </div>
            <div className="detail-copy">
              <div className="detail-summary">
              <Dialog.Title>{product.title}</Dialog.Title>
              <p className="detail-price">{productPrice(product)}</p>
              {product.condition !== "See item details" && (
                <p className="condition">{product.condition}</p>
              )}
              <Dialog.Description className="sr-only">
                Product photos, item SKU and listing details.
              </Dialog.Description>
              {!available && (
                <p className="notice" role="status">
                  Availability cannot be confirmed. Please ask an associate.
                </p>
              )}
              {singleVariant ? (
                <ItemSku sku={singleVariant.sku} storeSlug={storeSlug} visitorId={visitorId} productId={product.id} variantId={singleVariant.id} enabled={available} />
              ) : (
                <section
                  className="variant-options"
                  aria-label="Available options"
                >
                  {product.variants.map((variant) => (
                    <div className="variant-option" key={variant.id}>
                      <h3>
                        {variant.title}
                        <span>{money(variant.priceCents)}</span>
                      </h3>
                      <ItemSku sku={variant.sku} storeSlug={storeSlug} visitorId={visitorId} productId={product.id} variantId={variant.id} enabled={available} />
                    </div>
                  ))}
                </section>
              )}
              </div>
              <section className="listing-content" aria-label="Listing details">
                {product.details.length ? (
                  mainDetails.map((block, index) => (
                    <ListingBlock key={index} block={block} />
                  ))
                ) : product.description ? (
                  <p>{product.description}</p>
                ) : (
                  <p>No additional details provided.</p>
                )}
              </section>
            </div>
          </div>
              </ScrollArea.Content>
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar className="product-scrollbar" orientation="vertical">
              <ScrollArea.Thumb className="product-scroll-thumb" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
