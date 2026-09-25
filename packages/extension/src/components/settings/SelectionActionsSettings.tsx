import { useState } from "react";
import { GripVertical, X } from "lucide-react";
import {
  DEFAULT_CONTEXT_ACTIONS,
  DEFAULT_POPUP_ACTIONS,
  normalizeSelectionActions,
  SELECTION_ACTIONS,
  type SelectionActionId,
} from "../../domain/selection-actions";
import type { SaveExtensionSettings } from "../../hooks/useExtensionSettings";
import type { CmdkSettings } from "../../types/settings";

type ActionListKey = "selectionPopupActions" | "contextMenuSelectionActions";

const LISTS: Array<{
  key: ActionListKey;
  title: string;
  description: string;
  fallback: readonly SelectionActionId[];
}> = [
  {
    key: "selectionPopupActions",
    title: "Highlighted text popup",
    description: "These actions appear above Copy selected text.",
    fallback: DEFAULT_POPUP_ACTIONS,
  },
  {
    key: "contextMenuSelectionActions",
    title: "Right click menu",
    description: "These actions appear under Search selected text.",
    fallback: DEFAULT_CONTEXT_ACTIONS,
  },
];

export function SelectionActionsSettings({
  settings,
  saveSettings,
}: {
  settings: CmdkSettings;
  saveSettings: SaveExtensionSettings;
}) {
  const [dragged, setDragged] = useState<{ key: ActionListKey; id: SelectionActionId } | null>(null);

  const update = (key: ActionListKey, actions: SelectionActionId[]) => {
    void saveSettings({
      ...settings,
      contextMenu: {
        ...settings.contextMenu,
        [key]: normalizeSelectionActions(actions, []),
      },
    });
  };

  return (
    <section id="selection-actions" className="scroll-mt-20 space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Selected text actions</h2>
        <p className="text-muted-foreground">
          Choose up to three actions for each menu. Drag to reorder them.
        </p>
      </div>
      {LISTS.map((list) => {
        const actions = normalizeSelectionActions(settings.contextMenu?.[list.key], list.fallback);
        const available = SELECTION_ACTIONS.filter((action) => !actions.includes(action.id));
        return (
          <div key={list.key} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="font-semibold">{list.title}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{list.description}</p>
            <ol className="space-y-2" aria-label={`${list.title} actions`}>
              {actions.map((id, index) => {
                const label = SELECTION_ACTIONS.find((action) => action.id === id)?.label ?? id;
                return (
                  <li
                    key={id}
                    draggable
                    onDragStart={() => setDragged({ key: list.key, id })}
                    onDragEnd={() => setDragged(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!dragged || dragged.key !== list.key || dragged.id === id) return;
                      const reordered = actions.filter((action) => action !== dragged.id);
                      reordered.splice(index, 0, dragged.id);
                      update(list.key, reordered);
                      setDragged(null);
                    }}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
                  >
                    <GripVertical size={17} className="text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 text-sm">{label}</span>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                      disabled={index === 0}
                      aria-label={`Move ${label} up`}
                      onClick={() => {
                        const reordered = [...actions];
                        [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
                        update(list.key, reordered);
                      }}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                      disabled={index === actions.length - 1}
                      aria-label={`Move ${label} down`}
                      onClick={() => {
                        const reordered = [...actions];
                        [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
                        update(list.key, reordered);
                      }}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-muted"
                      aria-label={`Remove ${label}`}
                      onClick={() => update(list.key, actions.filter((action) => action !== id))}
                    >
                      <X size={16} />
                    </button>
                  </li>
                );
              })}
            </ol>
            {actions.length < 3 && available.length > 0 && (
              <select
                aria-label={`Add action to ${list.title}`}
                className="mt-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64"
                value=""
                onChange={(event) => {
                  const action = SELECTION_ACTIONS.find((candidate) => candidate.id === event.target.value);
                  if (action) update(list.key, [...actions, action.id]);
                }}
              >
                <option value="">Add action...</option>
                {available.map((action) => (
                  <option key={action.id} value={action.id}>{action.label}</option>
                ))}
              </select>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{actions.length} of 3 selected</p>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Look up text opens a Google definition search. Ask Gemini copies the selected text and opens Gemini for pasting.
      </p>
    </section>
  );
}
