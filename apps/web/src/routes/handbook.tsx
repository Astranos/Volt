import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AppShell } from "../components/app-shell";
import { HandbookPage } from "../components/handbook/handbook-page";
import { handbookLocation, handbookSearch, validateHandbookSearch } from "../lib/handbook-search";

export const Route = createFileRoute("/handbook")({
  validateSearch: validateHandbookSearch,
  component: HandbookRoute,
});

function HandbookRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/handbook" });
  return (
    <AppShell current="handbook">
      <HandbookPage
        location={handbookLocation(search)}
        navigate={(location, options) => void navigate({ search: handbookSearch(location), replace: options?.replace })}
      />
    </AppShell>
  );
}
