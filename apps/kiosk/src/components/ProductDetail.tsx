import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { DetailBlock, Product } from "../catalog";
import { money, productPrice } from "../browse";
import { ProductGallery } from "./ProductGallery";
import "./product-detail.css";

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
function ItemSku({ sku }: { sku: string | null }) {
  return (
    <div className="item-sku">
      <span>SKU</span>
      <strong>{sku || "Not provided"}</strong>
      {sku && <small>Give this SKU to an associate.</small>}
    </div>
  );
}
export function ProductDetail({
  product,
  available,
  onClose,
}: {
  product: Product;
  available: boolean;
  onClose: () => void;
}) {
  const singleVariant =
    product.variants.length === 1 ? product.variants[0] : null;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="product-dialog">
          <div className="dialog-top">
            <Dialog.Close className="button secondary">
              <X size={20} /> Close
            </Dialog.Close>
          </div>
          <div className="detail-layout">
            <ProductGallery images={product.images} title={product.title} />
            <div className="detail-copy">
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
                <ItemSku sku={singleVariant.sku} />
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
                      <ItemSku sku={variant.sku} />
                    </div>
                  ))}
                </section>
              )}
              <section className="listing-content" aria-label="Listing details">
                {product.details.length ? (
                  product.details.map((block, index) => (
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
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
