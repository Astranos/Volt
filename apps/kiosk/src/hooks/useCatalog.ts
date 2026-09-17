import { useCallback, useEffect, useState } from "react";
import { catalogResponseSchema, type CatalogResponse } from "../catalog";

type CatalogState =
  | { kind: "loading" }
  | { kind: "error"; unknownStore: boolean }
  | { kind: "ready"; catalog: CatalogResponse; failed: boolean };
export function useCatalog(slug: string) {
  const [state, setState] = useState<CatalogState>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 28_000);
    let active = true;
    async function load() {
      try {
        const response = await fetch(
          `/api/catalog?store=${encodeURIComponent(slug)}`,
          { signal: controller.signal },
        );
        if (response.status === 404) {
          if (active) setState({ kind: "error", unknownStore: true });
          return;
        }
        if (!response.ok) throw new Error("Catalog unavailable");
        const catalog = catalogResponseSchema.parse(await response.json());
        if (catalog.store.slug !== slug) throw new Error("Store mismatch");
        if (active) setState({ kind: "ready", catalog, failed: false });
      } catch {
        if (active)
          setState((previous) =>
            previous.kind === "ready"
              ? { ...previous, failed: true }
              : { kind: "error", unknownStore: false },
          );
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [slug, revision]);
  useEffect(() => {
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { state, refresh };
}
