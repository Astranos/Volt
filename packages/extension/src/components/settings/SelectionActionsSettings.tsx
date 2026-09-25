import { useMemo, useState } from "react";
import { GripVertical, Pencil, X } from "lucide-react";
import { HUGEICON_CATALOG } from "../../domain/hugeicon-catalog";
import { DEFAULT_CONTEXT_ACTIONS, DEFAULT_POPUP_ACTIONS, normalizeSelectionActions, SELECTION_ACTIONS, selectionActionKey, selectionActionLabel, selectionActionUrl, validCustomActionUrl, type CustomSelectionAction, type SelectionAction } from "../../domain/selection-actions";
import type { SaveExtensionSettings } from "../../hooks/useExtensionSettings";
import type { CmdkSettings } from "../../types/settings";

type ActionListKey = "selectionPopupActions" | "contextMenuSelectionActions";
const LISTS: Array<{ key: ActionListKey; title: string; description: string; fallback: readonly SelectionAction[] }> = [
  { key: "selectionPopupActions", title: "Highlighted text popup", description: "These actions appear above Copy selected text.", fallback: DEFAULT_POPUP_ACTIONS },
  { key: "contextMenuSelectionActions", title: "Right click menu", description: "These actions appear under Search selected text.", fallback: DEFAULT_CONTEXT_ACTIONS },
];
const DEFAULT_ICON = HUGEICON_CATALOG.find(([name]) => name === "search-01") ?? HUGEICON_CATALOG[0];

function CustomActionEditor({ initial, onSave, onCancel }: { initial?: CustomSelectionAction; onSave: (action: CustomSelectionAction) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [icon, setIcon] = useState<readonly [string, number]>(HUGEICON_CATALOG.find(([name]) => name === initial?.iconName) ?? DEFAULT_ICON);
  const [query, setQuery] = useState("");
  const [showIcons, setShowIcons] = useState(false);
  const matches = useMemo(() => HUGEICON_CATALOG.filter(([name]) => name.includes(query.trim().toLowerCase().replace(/\s+/g, "-"))).slice(0, 60), [query]);
  const valid = label.trim().length > 0 && label.trim().length <= 48 && validCustomActionUrl(url);
  return (
    <form className="mt-3 space-y-3 rounded-lg border border-border bg-background p-4" onSubmit={(event) => {
      event.preventDefault();
      if (valid) onSave({ kind: "custom", id: initial?.id ?? crypto.randomUUID(), label: label.trim(), iconName: icon[0], iconCodepoint: icon[1], url });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium"><span>Label</span><input className="h-10 w-full rounded-md border border-input bg-background px-3" maxLength={48} onChange={(event) => setLabel(event.target.value)} placeholder="Search my library" required value={label} /></label>
        <label className="space-y-1 text-sm font-medium"><span>URL to append selected text to</span><input className="h-10 w-full rounded-md border border-input bg-background px-3" onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/search?q=" required type="url" value={url} /></label>
      </div>
      <p className="break-all text-xs text-muted-foreground">{validCustomActionUrl(url) ? `Example: ${selectionActionUrl({ kind: "custom", id: "preview", label: label || "Preview", iconName: icon[0], iconCodepoint: icon[1], url }, "red & blue")}` : "Use a full https:// or http:// URL. The highlighted text is URL encoded and added to the end."}</p>
      <div>
        <span className="block text-sm font-medium">Hugeicon</span>
        <button className="mt-1 flex h-10 items-center gap-2 rounded-md border border-input px-3 text-sm" onClick={() => setShowIcons((value) => !value)} type="button"><span aria-hidden="true" className="volt-hugeicon text-lg">{String.fromCodePoint(icon[1])}</span>{icon[0].replaceAll("-", " ")}</button>
        {showIcons && <div className="mt-2 rounded-lg border border-border p-2">
          <label className="block text-xs font-medium" htmlFor="hugeicon-search">Search icons</label>
          <input autoFocus className="mt-1 h-9 w-full rounded-md border border-input px-3 text-sm" id="hugeicon-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search 6,228 icons" value={query} />
          <div aria-label="Hugeicons results" className="mt-2 grid max-h-56 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-8">
            {matches.map(([name, codepoint]) => <button aria-label={name.replaceAll("-", " ")} aria-pressed={icon[0] === name} className="flex h-12 items-center justify-center rounded hover:bg-muted aria-pressed:bg-muted" key={name} onClick={() => { setIcon([name, codepoint]); setShowIcons(false); }} title={name.replaceAll("-", " ")} type="button"><span aria-hidden="true" className="volt-hugeicon text-xl">{String.fromCodePoint(codepoint)}</span></button>)}
          </div>
          {matches.length === 0 && <p className="p-2 text-xs text-muted-foreground">No icons found.</p>}
        </div>}
      </div>
      <div className="flex gap-2"><button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40" disabled={!valid} type="submit">Save custom action</button><button className="rounded-md border border-border px-3 py-2 text-sm" onClick={onCancel} type="button">Cancel</button></div>
    </form>
  );
}

export function SelectionActionsSettings({ settings, saveSettings }: { settings: CmdkSettings; saveSettings: SaveExtensionSettings }) {
  const [dragged, setDragged] = useState<{ key: ActionListKey; id: string } | null>(null);
  const [editing, setEditing] = useState<{ key: ActionListKey; id?: string; replaceId?: string } | null>(null);
  const update = (key: ActionListKey, actions: SelectionAction[]) => {
    void saveSettings({ ...settings, contextMenu: { ...settings.contextMenu, [key]: normalizeSelectionActions(actions, []) } });
  };
  const saveCustom = (key: ActionListKey, actions: SelectionAction[], custom: CustomSelectionAction) => {
    if (!editing || editing.key !== key) return;
    let nextActions: SelectionAction[];
    if (editing.id) {
      nextActions = actions.map((action) => typeof action !== "string" && action.id === editing.id ? custom : action);
    } else if (editing.replaceId) {
      nextActions = actions.map((action) => selectionActionKey(action) === editing.replaceId ? custom : action);
    } else {
      nextActions = [...actions, custom];
    }
    update(key, nextActions);
    setEditing(null);
  };
  return (
    <section id="selection-actions" className="scroll-mt-20 space-y-5">
      <div><h2 className="text-2xl font-bold">Selected text actions</h2><p className="text-muted-foreground">Choose up to three actions for each menu. Use each dropdown to change an action, or drag to reorder them.</p></div>
      {LISTS.map((list) => {
        const actions = normalizeSelectionActions(settings.contextMenu?.[list.key], list.fallback);
        const available = SELECTION_ACTIONS.filter((candidate) => !actions.some((action) => action === candidate.id));
        const edited = editing?.key === list.key ? actions.find((action) => typeof action !== "string" && action.id === editing.id) : undefined;
        return <div key={list.key} className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h3 className="font-semibold">{list.title}</h3><p className="mb-4 text-sm text-muted-foreground">{list.description}</p>
          <ol aria-label={`${list.title} actions`} className="space-y-2">{actions.map((action, index) => {
            const id = selectionActionKey(action);
            const label = selectionActionLabel(action);
            return <li className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2" draggable key={id}
              onDragStart={() => setDragged({ key: list.key, id })} onDragEnd={() => setDragged(null)} onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); if (!dragged || dragged.key !== list.key || dragged.id === id) return; const moved = actions.find((candidate) => selectionActionKey(candidate) === dragged.id); const reordered = actions.filter((candidate) => selectionActionKey(candidate) !== dragged.id); if (moved) { reordered.splice(index, 0, moved); update(list.key, reordered); } setDragged(null); }}>
              <GripVertical aria-hidden="true" className="text-muted-foreground" size={17} />
              {typeof action !== "string" && <span aria-hidden="true" className="volt-hugeicon text-lg">{String.fromCodePoint(action.iconCodepoint)}</span>}
              <select
                aria-label={`Action ${index + 1} in ${list.title}`}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                onChange={(event) => {
                  if (event.target.value === "create-custom") {
                    setEditing({ key: list.key, replaceId: id });
                    return;
                  }
                  const replacement = SELECTION_ACTIONS.find((candidate) => candidate.id === event.target.value);
                  if (replacement) {
                    update(list.key, actions.map((current, currentIndex) => currentIndex === index ? replacement.id : current));
                    setEditing(null);
                  }
                }}
                value={id}
              >
                <option value={id}>{label}</option>
                {available.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                <option value="create-custom">Create custom action...</option>
              </select>
              {typeof action !== "string" && <button aria-label={`Edit ${label}`} className="rounded p-1 hover:bg-muted" onClick={() => setEditing({ key: list.key, id: action.id })} type="button"><Pencil size={15} /></button>}
              <button aria-label={`Remove ${label}`} className="rounded p-1 hover:bg-muted" onClick={() => update(list.key, actions.filter((candidate) => selectionActionKey(candidate) !== id))} type="button"><X size={16} /></button>
            </li>;
          })}</ol>
          {actions.length < 3 && <div className="mt-3 flex flex-wrap items-center gap-2">
            {available.length > 0 && <select aria-label={`Add action to ${list.title}`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64" onChange={(event) => { const found = SELECTION_ACTIONS.find((candidate) => candidate.id === event.target.value); if (found) update(list.key, [...actions, found.id]); }} value=""><option value="">Add built-in action...</option>{available.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select>}
            <button className="h-10 rounded-md border border-border px-3 text-sm hover:bg-muted" onClick={() => setEditing({ key: list.key })} type="button">Create custom action</button>
          </div>}
          {editing?.key === list.key && (actions.length < 3 || edited || editing.replaceId) && <CustomActionEditor initial={typeof edited === "string" ? undefined : edited} key={`${list.key}:${editing.id ?? editing.replaceId ?? "new"}`} onCancel={() => setEditing(null)} onSave={(custom) => saveCustom(list.key, actions, custom)} />}
          <p className="mt-3 text-xs text-muted-foreground">{actions.length} of 3 selected</p>
        </div>;
      })}
      <p className="text-xs text-muted-foreground">Look up text opens a Google definition search. Ask Gemini copies the selected text and opens Gemini for pasting.</p>
    </section>
  );
}
