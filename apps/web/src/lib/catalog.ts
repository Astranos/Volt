import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export type CatalogResult = FunctionReturnType<
  typeof api.productData.searchProducts
>["page"][number];
export type CatalogProduct = NonNullable<
  FunctionReturnType<typeof api.productData.getProductByUpc>
>;
export type CatalogListing = CatalogProduct["listings"][number];
export type CatalogSort = "relevance" | "title" | "updated";
export type CatalogFilters = {
  brand: string;
  platform: string;
  sort: CatalogSort;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function catalogDate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : dateFormatter.format(date);
}

export function safeCatalogUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  const valuesByKey = new Map<string, string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !valuesByKey.has(trimmed.toLowerCase())) {
      valuesByKey.set(trimmed.toLowerCase(), trimmed);
    }
  }
  return [...valuesByKey.values()];
}

export function catalogCollections(product: CatalogProduct): string[] {
  const collections = uniqueValues(product.collections ?? []);
  return collections.length > 0 ? collections : uniqueValues([product.collection]);
}

function attributeLabel(key: string): string {
  return key
    .replace(/([a-z\d])([A-Z])/g, (_match, before: string, after: string) => `${before} ${after.toLowerCase()}`)
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function catalogFacts(
  product: CatalogProduct,
): Array<{ label: string; value: string }> {
  const values: Array<{ label: string; value: string | null }> = [
    { label: "UPC", value: product.upc },
    { label: "MPN", value: product.mpn },
    { label: "Brand", value: product.brand },
    { label: "Model", value: product.model },
    { label: "Storage", value: product.storage },
    { label: "Color", value: product.color },
    { label: "Carrier", value: product.carrier },
    { label: "Platform", value: product.platform },
    { label: "Edition", value: product.edition },
    { label: "Publisher", value: product.publisher },
    { label: "Genre", value: product.genre },
    { label: "Rating", value: product.rating },
    { label: "Release year", value: product.releaseYear },
  ];
  const facts = values.flatMap(({ label, value }) =>
    value?.trim() ? [{ label, value: value.trim() }] : [],
  );
  const labels = new Set(facts.map((fact) => fact.label.toLowerCase()));
  for (const [key, value] of Object.entries(product.attributes).sort(([a], [b]) => a.localeCompare(b))) {
    const label = attributeLabel(key);
    if (!label || !value.trim() || labels.has(label.toLowerCase())) continue;
    labels.add(label.toLowerCase());
    facts.push({ label, value: value.trim() });
  }
  const aliases = uniqueValues(product.upcs).filter((upc) => upc !== product.upc);
  if (aliases.length > 0) facts.push({ label: "Additional UPCs", value: aliases.join(", ") });
  return facts;
}

export function catalogSummary(product: CatalogProduct): string {
  const collections = catalogCollections(product);
  return [
    product.title,
    ...catalogFacts(product).map(({ label, value }) => `${label}: ${value}`),
    ...(collections.length ? [`Collections: ${collections.join(", ")}`] : []),
  ].join("\n");
}

function csvCell(value: string | null): string {
  const text = value ?? "";
  // Quoting CSV alone does not stop spreadsheet formulas. Prefix risky cells,
  // including leading whitespace that spreadsheet importers may strip.
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function catalogCsv(products: CatalogResult[]): string {
  const header = ["UPC", "Title", "MPN", "Brand", "Model", "Platform", "Edition", "Storage", "Color", "Carrier", "Updated at"];
  const rows = products.map((product) => [
    product.upc,
    product.title,
    product.mpn,
    product.brand,
    product.model,
    product.platform,
    product.edition,
    product.storage,
    product.color,
    product.carrier,
    Number.isFinite(product.updatedAt) && !Number.isNaN(new Date(product.updatedAt).getTime())
      ? new Date(product.updatedAt).toISOString()
      : "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function catalogFilterOptions(products: CatalogResult[]): {
  brands: string[];
  platforms: string[];
} {
  return {
    brands: uniqueValues(products.map((product) => product.brand)).sort((a, b) => a.localeCompare(b)),
    platforms: uniqueValues(products.map((product) => product.platform)).sort((a, b) => a.localeCompare(b)),
  };
}

export function filterCatalogResults(
  products: CatalogResult[],
  filters: CatalogFilters,
): CatalogResult[] {
  const matches = products.filter((product) =>
    (!filters.brand || product.brand?.trim().toLowerCase() === filters.brand.trim().toLowerCase()) &&
    (!filters.platform || product.platform?.trim().toLowerCase() === filters.platform.trim().toLowerCase()),
  );
  switch (filters.sort) {
    case "relevance": return matches;
    case "title": return matches.sort((a, b) => a.title.localeCompare(b.title) || a.upc.localeCompare(b.upc));
    case "updated": return matches.sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
    default: {
      const exhaustive: never = filters.sort;
      return exhaustive;
    }
  }
}
