import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  createPublicSearch,
  searchValidation,
  type PublicSearchResult,
  type PublicSearchState,
} from "../../lib/upc-search";
import {
  PublicSearchResults,
  PublicUpcSearch,
  UpcSearchGuide,
} from "./public-upc-search";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const result: PublicSearchResult = {
  products: [
    {
      upc: "012345678905",
      title: "Example game",
      brand: "Example",
      model: "Model",
      mpn: "MODEL-1",
      platform: "Switch",
      edition: "Standard",
      storage: null,
      color: null,
      carrier: null,
      updatedAt: 1,
    },
  ],
  hasMore: true,
};

describe("public UPC search", () => {
  test("renders landing content without an auth or router provider", () => {
    const html = renderToStaticMarkup(<PublicUpcSearch />);
    expect(html).toContain("Find the UPC for");
    expect(html).toContain('action="/upc-search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('minLength="2"');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain("No account needed");
    expect(html).not.toContain("012345678905");
  });
  test("shows exact UPC strings, variants, cap, and copy control", () => {
    const html = renderToStaticMarkup(
      <PublicSearchResults
        state={{ kind: "success", query: "game", result }}
        retry={() => {}}
      />,
    );
    expect(html).toContain("012345678905");
    expect(html).toContain("Copy UPC 012345678905");
    expect(html).toContain("Switch · Standard");
    expect(html).toContain("Showing up to 20 matches");
    expect(html).not.toContain("Load more");
  });
  test("offers honest coverage and conversion links in server-rendered guide", () => {
    const html = renderToStaticMarkup(<UpcSearchGuide />);
    expect(html).toContain("not a complete registry");
    expect(html).toContain("does not issue codes");
    expect(html).toContain('href="/api-keys"');
    expect(html).toContain('href="/sign-up"');
  });
  test("empty and failure states offer recovery", () => {
    expect(
      renderToStaticMarkup(
        <PublicSearchResults
          state={{
            kind: "success",
            query: "missing",
            result: { products: [], hasMore: false },
          }}
          retry={() => {}}
        />,
      ),
    ).toContain("Try a shorter product name");
    expect(
      renderToStaticMarkup(
        <PublicSearchResults
          state={{ kind: "error", query: "test", message: "Try later" }}
          retry={() => {}}
        />,
      ),
    ).toContain("Try again");
  });
  test("validates before fetching and preserves UPC leading zeros", async () => {
    const fetch = vi.fn(async () => result);
    const states: PublicSearchState[] = [];
    const search = createPublicSearch(fetch, (state) => states.push(state));
    await search.search("x");
    expect(fetch).not.toHaveBeenCalled();
    expect(searchValidation("x".repeat(121))).not.toBeNull();
    await search.search(" 012345678905 ");
    expect(fetch).toHaveBeenCalledWith("012345678905");
    expect(states.at(-1)).toEqual({
      kind: "success",
      query: "012345678905",
      result,
    });
  });
  test("suppresses stale success and errors and cancels on unmount", async () => {
    const first = deferred<PublicSearchResult>();
    const second = deferred<PublicSearchResult>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const states: PublicSearchState[] = [];
    const search = createPublicSearch(fetch, (state) => states.push(state));
    const pendingFirst = search.search("first");
    const pendingSecond = search.search("second");
    second.resolve(result);
    await pendingSecond;
    first.reject(new Error("private backend error"));
    await pendingFirst;
    expect(states.at(-1)).toEqual({ kind: "success", query: "second", result });
    const third = deferred<PublicSearchResult>();
    const cancelledStates: PublicSearchState[] = [];
    const cancelled = createPublicSearch(
      () => third.promise,
      (state) => cancelledStates.push(state),
    );
    const pendingThird = cancelled.search("third");
    cancelled.cancel();
    third.resolve(result);
    await pendingThird;
    expect(cancelledStates).toEqual([{ kind: "loading", query: "third" }]);
  });
});
