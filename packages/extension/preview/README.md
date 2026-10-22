# Extension preview

Renders real extension UI in a normal browser tab, with the extension APIs
stubbed and sample data, so it can be screenshotted for PRs.

```sh
pnpm shots --list                                   # what can be captured
pnpm shots newtab "newtab?q=s+iphone" --dark        # light + dark PNGs in packages/extension/.shots/
pnpm shots scanner-history --before origin/main     # before, after, and a side-by-side compare
pnpm shots context-menu --before origin/main --publish   # also upload and print PR Markdown
pnpm --filter @volt/extension preview               # browse scenarios interactively
```

- **`--before <ref>`** renders the same scenarios against a temporary checkout of
  `<ref>` (sharing this checkout's `node_modules`), then joins each pair side by side.
- **`--publish`** commits the images to a `pr-assets/<branch>` branch, which is
  never merged, and prints `![...](...)` lines to paste into the PR body. Use
  `--name` to pick a different branch name.
- Uses the installed Google Chrome. The clock is pinned to 10:30 AM, Oct 18 2026
  so times match between runs. Product photos load from Wikimedia, so it needs
  the network.

## Adding a scenario

Every file in `scenarios/` is a scenario named after the file. It renders the
real component and says which extension data it needs:

```tsx
export default defineScenario({
  description: "One line for --list",
  viewport: { width: 380, height: 760 },
  chrome: {
    storage: { local: { someKey: "value" } },          // chrome.storage seed
    messages: { GET_CLOSED_TABS: () => ({ tabs }) },  // runtime.sendMessage, by `action`
    apis: { "bookmarks.getTree": tree },               // any other chrome.* call
  },
  render: (params) => <Component state={params.get("state")} />,
  act: async (params) => { /* optional: type a search, open a menu */ },
});
```

Query strings after the scenario name (`scanner-history?state=loading`) reach
`render` and `act`, so one scenario can cover several states. Shared sample
data lives in `fixtures/`; `dom.ts` has helpers for `act`. Unstubbed `chrome.*`
calls resolve to `undefined`.

Prefer a scenario that renders a whole page (like `newtab`) when the page has no
sign-in or server dependency; otherwise render the components that changed (like
`scanner-history`) with fixture props.
