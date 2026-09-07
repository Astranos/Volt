import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export const UPC_SEARCH_TITLE = "Free UPC Lookup & Product Search | Volt";
export const UPC_SEARCH_DESCRIPTION =
  "Find UPC codes by product name, barcode, or manufacturer part number. Search Volt's electronics and video game catalog for free. No account needed.";
export const UPC_SEARCH_CANONICAL = "https://volt.juanquenga.com/upc-search";

export type PublicSearchResult = FunctionReturnType<
  typeof api.productData.searchPublicProducts
>;
export type PublicSearchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "success"; query: string; result: PublicSearchResult }
  | { kind: "error"; query: string; message: string };

export function searchValidation(query: string): string | null {
  const length = query.trim().length;
  return length < 2 || length > 120
    ? "Enter 2 to 120 characters to search."
    : null;
}

/** Each new request invalidates older responses, including failures. */
export function createPublicSearch(
  queryProducts: (query: string) => Promise<PublicSearchResult>,
  onState: (state: PublicSearchState) => void,
) {
  let revision = 0;
  return {
    cancel() {
      revision += 1;
    },
    async search(value: string) {
      const request = ++revision;
      const query = value.trim();
      if (!query) {
        onState({ kind: "idle" });
        return;
      }
      const message = searchValidation(query);
      if (message) {
        onState({ kind: "error", query, message });
        return;
      }
      onState({ kind: "loading", query });
      try {
        const result = await queryProducts(query);
        if (request === revision) onState({ kind: "success", query, result });
      } catch {
        if (request === revision)
          onState({
            kind: "error",
            query,
            message: "We couldn't load results. Please try again in a moment.",
          });
      }
    },
  };
}
