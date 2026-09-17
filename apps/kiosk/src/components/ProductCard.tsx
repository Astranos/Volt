import { Button } from "@base-ui/react/button";
import { ArrowUpRight, Package } from "lucide-react";
import { useState } from "react";
import type { Product } from "../catalog";
import { productPrice } from "../browse";

export function ProductCard({
  product,
  onOpen,
}: {
  product: Product;
  onOpen: () => void;
}) {
  const [failedImage, setFailedImage] = useState(false);
  return (
    <Button className="product-card" onClick={onOpen}>
      <div className="product-image">
        {product.images[0] && !failedImage ? (
          <img
            src={product.images[0]}
            alt=""
            loading="lazy"
            onError={() => setFailedImage(true)}
          />
        ) : (
          <Package size={48} />
        )}
        <span className="view-item">
          <ArrowUpRight size={21} />
        </span>
      </div>
      <div className="product-copy">
        <span className="category-label">{product.category}</span>
        <h3>{product.title}</h3>
        {product.variants.length === 1 && product.variants[0]?.sku && <p className="card-sku">SKU {product.variants[0].sku}</p>}
        <div className="product-bottom">
          <strong>{productPrice(product)}</strong>
          <span>{product.condition}</span>
        </div>
      </div>
    </Button>
  );
}
