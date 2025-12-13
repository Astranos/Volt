# New Tab Command Menu & Layout Redesign Plan

Target file: `entrypoints/newtab/NewTab.tsx`

This document describes the desired behavior and layout for the New Tab replacement, so another model can implement it safely and incrementally.

---

## 1. High‑Level Goals

- Turn the New Tab into a powerful command menu focused on:
  - Quickly reopening recently closed tabs.
  - Surfacing past actions/history under the command input.
  - Providing fast access to quick links and bookmarks in side columns.
- Keep the interface clean and keyboard‑friendly while remaining visually balanced.

---

## 2. Command Menu Behavior

### 2.1 Scope of Command Menu Items

- The primary command menu list (the main list under the input) should:
  - Preferably show **only previously closed tabs** as its main items.
  - Each item should include:
    - Page title.
    - Domain / URL snippet.
    - Time closed (relative, e.g., “5 min ago”), if available.
  - Trigger action: reopen the tab in the current window.
- Past actions/history should be displayed **below** the closed‑tabs list, visually separated.
  - Items: recent browsing history and/or previously executed commands (e.g., “Opened XYZ”, “Searched for ...”).
  - Each item should also be clickable and keyboard‑navigable.

### 2.2 Input and Filtering

- Command input at the top remains the primary focus.
- Typing in the input filters:
  - Closed tabs list (primary).
  - History/actions list (secondary).
- Matching strategy:
  - Fuzzy or substring match against title and URL.
  - Consider highlighting matched substrings in results.

### 2.3 Keyboard Navigation

- Up/Down arrows (or `Ctrl+J/K`) move through the main closed‑tabs list first.
- A separator and label (e.g., “History & Actions”) precede the secondary list.
- When focus reaches the bottom of closed tabs, continue into the history/actions list.
- Enter/Return:
  - On closed tab item → reopen tab.
  - On history/action item → navigate to URL or re‑trigger action.

---

## 3. Layout Changes

### 3.1 Overall Layout

- Center panel:
  - Command input at the top.
  - Closed tabs list below.
  - History/actions section below the closed tabs, separated by a labeled divider.
- Side panels:
  - **Left column**: Quick links (pinned links/shortcuts).
  - **Right column**: Bookmarks.
  - Both columns should be scrollable and searchable.

### 3.2 Side Columns (Quick Links & Bookmarks)

- Both columns should have:
  - A small header (e.g., “Quick Links”, “Bookmarks”).
  - A search/filter input at the top.
  - A vertically scrollable list of items.
- Quick links (left side):
  - Contains user‑defined or extension‑defined shortcuts (e.g., frequently used sites).
  - Items show an icon (favicon if available or placeholder), title, and an optional label/tag.
  - Clicking or pressing Enter on a focused item navigates to the URL.
- Bookmarks (right side):
  - Shows browser bookmarks (or a subset, e.g., bookmarks bar / top‑level folders).
  - Items show folder structure in a flat or lightly indented way.
  - Include a clear bookmark icon.

### 3.3 Responsiveness

- Desktop:
  - Three‑column layout: left (quick links) – center (command) – right (bookmarks).
  - Side columns should not be too wide; keep emphasis on the center command menu.
- Narrow viewport:
  - If space is constrained, side columns can:
    - Collapse into tabs above/below the center panel, or
    - Be hidden behind toggles (“Show Quick Links”, “Show Bookmarks”).
  - The plan can note responsiveness but implementation can be iterative.

---

## 4. Data & Integration Considerations

- Identify existing hooks/utilities for:
  - Recently closed tabs.
  - Browsing history.
  - Bookmarks and quick links (if any abstraction already exists).
- If the project already has content components for lists/cards:
  - Reuse existing components instead of writing from scratch.
- Ensure any browser APIs used are permitted in the extension’s permissions manifest.

---

## 5. Implementation Tasks (Suggested Sequence)

1. **Audit current NewTab UI**
   - Open `entrypoints/newtab/NewTab.tsx` and identify:
     - Current layout regions.
     - Existing command input implementation (if any).
     - Where recent tabs/history/links are currently surfaced, if at all.

2. **Refactor NewTab layout into three columns**
   - Use existing styling system (e.g., Tailwind or custom CSS).
   - Define a responsive container with:
     - Left column (quick links).
     - Center column (command menu + lists).
     - Right column (bookmarks).

3. **Implement command menu list for closed tabs**
   - Create or reuse a list component to render closed tabs under the input.
   - Implement filtering logic based on input.
   - Wire up click/keyboard actions to reopen tabs.

4. **Add history/actions section below closed tabs**
   - Add a labeled separator below the closed‑tabs list.
   - Render a second list for history/actions.
   - Ensure the same filtering and navigation patterns apply.

5. **Add searchable quick links column (left)**
   - Create a quick links panel with:
     - Header.
     - Search input.
     - Scrollable list of quick link items.
   - Implement filtering of quick links by the panel’s search input.

6. **Add searchable bookmarks column (right)**
   - Create a bookmarks panel mirroring the quick links panel.
   - Load bookmarks data via the appropriate hooks/utilities.
   - Implement search/filtering within bookmarks.

7. **Unify keyboard focus and accessibility**
   - Ensure tab order and focus states are clear.
   - Support arrow/Enter navigation in all lists.
   - Add ARIA labels and roles for inputs and lists where appropriate.

8. **Polish styling and responsiveness**
   - Fine‑tune spacing, colors, and typography to match the existing design system.
   - Verify behavior on common viewport sizes.

---

## 6. Nice‑to‑Have Enhancements (Optional Ideas)

The implementing model can pick and choose from these based on time:

- **Pinned items**:
  - Allow pinning specific closed tabs or history entries to always float to the top.
- **Command palette actions**:
  - Add non‑navigation commands (e.g., “Clear cache”, “Open extensions page”) as items in the command menu with an “Action” badge.
- **Grouping / sections**:
  - Group closed tabs by time (e.g., “Today”, “Yesterday”, “Earlier this week”).
  - Group bookmarks by folder, with collapsible folder headings.
- **Keyboard shortcuts hints**:
  - Show small hints (e.g., “Press `/` to focus search”, “Cmd+K to open command menu” if applicable).
- **Recent search queries**:
  - Below the input, show a few recent search queries as chips; selecting one re‑runs the query.
- **Theming**:
  - Add support for light/dark themes matching the rest of the extension.

---

## 7. Acceptance Criteria (Summary)

- Command area:
  - Closed tabs are the primary list under the input.
  - History/actions appear below closed tabs with a clear separator.
  - Input filters both lists.
- Layout:
  - Left column shows searchable, scrollable quick links.
  - Right column shows searchable, scrollable bookmarks.
  - Layout looks balanced and usable at typical desktop viewport sizes.
- Behavior:
  - Clicking or using keyboard selection on any list item performs the expected navigation or action.
  - UI remains responsive and accessible with keyboard and screen readers as much as feasible within existing patterns.

