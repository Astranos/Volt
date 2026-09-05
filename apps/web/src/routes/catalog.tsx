import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell";
import { CatalogBrowser } from "../components/catalog/catalog-browser";
import { CatalogActivity } from "../components/catalog/catalog-activity";

export const Route = createFileRoute("/catalog")({ component: CatalogPage });

function CatalogPage() {
  return (
    <AppShell current="product-data">
      <div className="space-y-6">
        <CatalogActivity />
        <CatalogBrowser />
      </div>
    </AppShell>
  );
}
