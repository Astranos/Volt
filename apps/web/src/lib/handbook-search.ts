import type { HandbookFilter } from "@volt/handbook";

import type { HandbookLocation, HandbookView } from "../components/handbook/handbook-page";

/** `?entry=<id>` opens an entry, `&edit=1` edits it, `?new=1` starts one; `?category=` or `?pinned=1` filters the list. */
export type HandbookSearch = {
  entry?: string;
  edit?: 1;
  new?: 1;
  category?: string;
  pinned?: 1;
};

const flag = (value: unknown) => (value === 1 || value === "1" || value === true ? 1 : undefined);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);

export function validateHandbookSearch(search: Record<string, unknown>): HandbookSearch {
  return {
    entry: text(search.entry),
    edit: flag(search.edit),
    new: flag(search.new),
    category: text(search.category),
    pinned: flag(search.pinned),
  };
}

export function handbookLocation(search: HandbookSearch): HandbookLocation {
  const view: HandbookView = search.new ? { kind: "new" }
    : search.entry ? { kind: search.edit ? "edit" : "article", id: search.entry }
      : { kind: "list" };
  const filter: HandbookFilter = search.category ? { kind: "category", category: search.category }
    : search.pinned ? { kind: "pinned" }
      : { kind: "all" };
  return { view, filter };
}

export function handbookSearch({ view, filter }: HandbookLocation): HandbookSearch {
  return {
    entry: view.kind === "article" || view.kind === "edit" ? view.id : undefined,
    edit: view.kind === "edit" ? 1 : undefined,
    new: view.kind === "new" ? 1 : undefined,
    category: filter.kind === "category" ? filter.category : undefined,
    pinned: filter.kind === "pinned" ? 1 : undefined,
  };
}
