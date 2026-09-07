import { createFileRoute } from "@tanstack/react-router";
import { PublicUpcSearch } from "../components/upc-search/public-upc-search";
import { SiteFooter, SiteHeader } from "../site-chrome";
import {
  UPC_SEARCH_CANONICAL,
  UPC_SEARCH_DESCRIPTION,
  UPC_SEARCH_TITLE,
} from "../lib/upc-search";

export const Route = createFileRoute("/upc-search")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  head: ({ match }) => ({
    meta: [
      { title: UPC_SEARCH_TITLE },
      { name: "description", content: UPC_SEARCH_DESCRIPTION },
      {
        name: "robots",
        content:
          match.search.q !== undefined ? "noindex, follow" : "index, follow",
      },
    ],
    links: [{ rel: "canonical", href: UPC_SEARCH_CANONICAL }],
  }),
  component: UpcSearchPage,
});

function UpcSearchPage() {
  const { q } = Route.useSearch();
  return (
    <>
      <SiteHeader />
      <main>
        <PublicUpcSearch initialQuery={q} />
      </main>
      <SiteFooter />
    </>
  );
}
