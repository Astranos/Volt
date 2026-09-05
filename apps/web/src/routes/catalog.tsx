import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell";
import { CatalogBrowser } from "../components/catalog/catalog-browser";

export const Route = createFileRoute("/catalog")({ component: CatalogPage });

function CatalogPage() {
  return <AppShell current="product-data"><CatalogBrowser /></AppShell>;
}
