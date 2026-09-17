import type { Category, Product } from "./catalog";

export type BrowseFilters = {
  query: string;
  category: Category | "All";
  budget: number;
  sort: "newest" | "low" | "high";
};
export const initialFilters: BrowseFilters = {
  query: "",
  category: "All",
  budget: 0,
  sort: "newest",
};
export function browseProducts(
  products: Product[],
  filters: BrowseFilters,
): Product[] {
  const words = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return products
    .filter((product) => {
      const text =
        `${product.title} ${product.category} ${product.description} ${product.variants.map(variant => variant.sku || '').join(' ')}`.toLowerCase();
      return (
        (filters.category === "All" || product.category === filters.category) &&
        (!filters.budget || product.priceCents <= filters.budget) &&
        words.every((word) => text.includes(word))
      );
    })
    .sort((a, b) =>
      filters.sort === "low"
        ? a.priceCents - b.priceCents
        : filters.sort === "high"
          ? b.priceCents - a.priceCents
          : Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    );
}
export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}
export function productPrice(product: Product): string {
  return product.priceMaxCents > product.priceCents
    ? `From ${money(product.priceCents)}`
    : money(product.priceCents);
}
export function routeSlug(path: string): string | null {
  const match = /^\/([a-z0-9-]+)\/?$/.exec(path);
  return match?.[1] ?? null;
}
