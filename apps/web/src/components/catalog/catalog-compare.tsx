import type { CatalogResult } from "../../lib/catalog";

export function toggleComparison(
  products: CatalogResult[],
  product: CatalogResult,
): CatalogResult[] {
  if (products.some((row) => row.upc === product.upc))
    return products.filter((row) => row.upc !== product.upc);
  return products.length < 3 ? [...products, product] : products;
}

const fields = [
  "upc",
  "mpn",
  "brand",
  "model",
  "storage",
  "color",
  "carrier",
  "platform",
  "edition",
] satisfies Array<keyof CatalogResult>;
const labels = {
  upc: "UPC",
  mpn: "MPN",
  brand: "Brand",
  model: "Model",
  storage: "Storage",
  color: "Color",
  carrier: "Carrier",
  platform: "Platform",
  edition: "Edition",
};

export function CatalogCompare({
  products,
  onRemove,
  onClear,
}: {
  products: CatalogResult[];
  onRemove: (upc: string) => void;
  onClear: () => void;
}) {
  return (
    <section
      aria-label="Product comparison"
      className="overflow-hidden rounded-xl border border-emerald-200 bg-white"
    >
      <div className="flex items-center justify-between gap-3 bg-emerald-50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-emerald-950">
            Compare products · {products.length}/3
          </h2>
          <p className="mt-1 text-xs text-emerald-800">
            Kept across searches until removed. Add up to three products.
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-emerald-800 underline focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          Clear comparison
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            Side-by-side product specifications. Not provided means the catalog
            has no value.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="min-w-24 px-4 py-3 font-medium text-zinc-500"
              >
                Specification
              </th>
              {products.map((product) => (
                <th
                  key={product.upc}
                  scope="col"
                  className="min-w-48 max-w-72 px-4 py-3 align-top"
                >
                  <span className="block text-sm leading-5 text-zinc-950">
                    {product.title}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${product.title} from comparison`}
                    onClick={() => onRemove(product.upc)}
                    className="mt-2 rounded text-xs font-medium text-zinc-500 underline focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    Remove
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field} className="border-t border-zinc-100">
                <th
                  scope="row"
                  className="px-4 py-2.5 font-medium text-zinc-500"
                >
                  {labels[field]}
                </th>
                {products.map((product) => (
                  <td
                    key={product.upc}
                    className="break-words px-4 py-2.5 text-zinc-800"
                  >
                    {product[field] || (
                      <span className="text-zinc-400">Not provided</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
