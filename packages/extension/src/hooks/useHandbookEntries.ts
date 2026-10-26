import { useConvexAuth, useQuery, useQuery_experimental } from "convex/react";
import { api } from "../../../../convex/_generated/api";

/** The signed-in account's handbook. Secret entries carry only a masked preview. */
export function useHandbookEntries() {
  const { isAuthenticated } = useConvexAuth();
  return useQuery_experimental({ query: api.handbook.entries, args: isAuthenticated ? {} : "skip" });
}

/** The account's saved category order; empty until it loads or if none was saved. */
export function useHandbookCategoryOrder(): string[] {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.handbook.categoryOrder, isAuthenticated ? {} : "skip") ?? [];
}
