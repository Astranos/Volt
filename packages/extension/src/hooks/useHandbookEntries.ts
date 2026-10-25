import { useConvexAuth, useQuery_experimental } from "convex/react";
import { api } from "../../../../convex/_generated/api";

/** The signed-in account's handbook. Secret entries carry only a masked preview. */
export function useHandbookEntries() {
  const { isAuthenticated } = useConvexAuth();
  return useQuery_experimental({ query: api.handbook.list, args: isAuthenticated ? { includePages: true } : "skip" });
}
