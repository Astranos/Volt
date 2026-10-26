import type { ShopifyProductDetails } from "../domain/shopify-audit";
import { partitionListing, type DetailBlock } from "./listing";

/** One comparable attribute; `values` is indexed like `CompareModel.items` ("" when missing). */
export type CompareRow = { label: string; values: string[]; differs: boolean };

export type CompareItem = {
  product: ShopifyProductDetails;
  conditionNotes: DetailBlock[];
  otherDetails: DetailBlock[];
  isLowestPrice: boolean;
};

export type CompareModel = {
  items: CompareItem[];
  facts: CompareRow[];
  specs: CompareRow[];
  hasNotes: boolean;
  hasDetails: boolean;
};

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

const sentenceCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

/** Pulls spec tables out of listing details (with the heading that introduces them). */
export function splitSpecifications(blocks: readonly DetailBlock[]): { specs: Array<{ label: string; value: string }>; rest: DetailBlock[] } {
  const specs: Array<{ label: string; value: string }> = [];
  const rest: DetailBlock[] = [];
  blocks.forEach((block, index) => {
    if (block.kind === "specifications") specs.push(...block.rows);
    else if (block.kind !== "heading" || blocks[index + 1]?.kind !== "specifications") rest.push(block);
  });
  return { specs, rest };
}

function row(label: string, values: string[]): CompareRow {
  return { label, values, differs: new Set(values.map(normalize)).size > 1 };
}

export function buildCompareModel(products: readonly ShopifyProductDetails[], detailsFor: (product: ShopifyProductDetails) => DetailBlock[]): CompareModel {
  const split = products.map((product) => {
    const { conditionNotes, mainDetails } = partitionListing(detailsFor(product));
    return { conditionNotes, ...splitSpecifications(mainDetails) };
  });

  const prices = products.map((product) => Number(product.minPrice)).filter((price) => Number.isFinite(price) && price > 0);
  const lowest = prices.length > 1 && new Set(prices).size > 1 ? Math.min(...prices) : null;

  const facts = ([
    ["Condition", (product) => product.condition],
    ["Status", (product) => sentenceCase(product.status)],
    ["Vendor", (product) => product.vendor],
    ["Type", (product) => product.productType],
  ] satisfies Array<[string, (product: ShopifyProductDetails) => string | null]>)
    .map(([label, read]) => row(label, products.map((product) => read(product) ?? "")))
    .filter((fact) => fact.values.some(Boolean));

  const specLabels = new Map<string, string>();
  for (const { specs } of split) {
    for (const spec of specs) if (!specLabels.has(normalize(spec.label))) specLabels.set(normalize(spec.label), spec.label);
  }
  const specs = [...specLabels].map(([key, label]) =>
    row(label, split.map(({ specs: own }) => own.find((spec) => normalize(spec.label) === key)?.value ?? "")));

  return {
    items: products.map((product, index) => ({
      product,
      conditionNotes: split[index].conditionNotes,
      otherDetails: split[index].rest,
      isLowestPrice: lowest !== null && Number(product.minPrice) === lowest,
    })),
    facts,
    specs,
    hasNotes: split.some(({ conditionNotes }) => conditionNotes.length > 0),
    hasDetails: split.some(({ rest }) => rest.length > 0),
  };
}

/** Rows each column spans in the shared subgrid; must match CompareColumn's children. */
export function compareRowCount(model: Pick<CompareModel, "facts" | "specs" | "hasNotes" | "hasDetails">): number {
  return 3 + model.facts.length + 1 + (model.hasNotes ? 1 : 0) + (model.specs.length ? 1 + model.specs.length : 0) + (model.hasDetails ? 1 : 0);
}
