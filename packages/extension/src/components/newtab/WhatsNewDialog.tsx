import { useEffect, useState } from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
import { ScrollBar } from "../ui/scroll-area";
import {
  RELEASE_NOTES,
  RELEASE_NOTES_ID,
  RELEASE_SETTINGS_LINKS,
  WHATS_NEW_SEEN_NOTES_KEY,
  WHATS_NEW_SEEN_VERSION_KEY,
  markReleaseNotesSeen,
  shouldAnnounceRelease,
} from "./release-notes";
import "./whats-new-dialog.css";

/** Pops "What's new" for an announced release; otherwise only flags the notes as unread. */
export function useWhatsNew() {
  const [version] = useState(() => chrome.runtime.getManifest().version);
  const [open, setOpen] = useState<"auto" | "manual" | null>(null);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let canceled = false;
    let versionChanged = false;
    let notesChanged = false;
    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== "local") return;
      if (WHATS_NEW_SEEN_VERSION_KEY in changes) {
        versionChanged = true;
        if (!shouldAnnounceRelease(changes[WHATS_NEW_SEEN_VERSION_KEY].newValue)) {
          setOpen((current) => current === "auto" ? null : current);
        }
      }
      if (WHATS_NEW_SEEN_NOTES_KEY in changes) {
        notesChanged = true;
        setUnread(changes[WHATS_NEW_SEEN_NOTES_KEY].newValue !== RELEASE_NOTES_ID);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    void chrome.storage.local.get([WHATS_NEW_SEEN_VERSION_KEY, WHATS_NEW_SEEN_NOTES_KEY]).then((stored) => {
      if (canceled) return;
      if (!versionChanged && shouldAnnounceRelease(stored[WHATS_NEW_SEEN_VERSION_KEY])) {
        setOpen((current) => current ?? "auto");
      }
      if (!notesChanged) setUnread(stored[WHATS_NEW_SEEN_NOTES_KEY] !== RELEASE_NOTES_ID);
    });
    return () => {
      canceled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const close = () => {
    setOpen(null);
    setUnread(false);
    void markReleaseNotesSeen(version);
  };

  return { version, open: open !== null, unread, show: () => setOpen("manual"), close };
}

/** Non-modal card pinned to the bottom-right corner; the page stays usable behind it. */
export function WhatsNewDialog({ version, onClose }: { version: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("[cmdk-root]")) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && (focused.isContentEditable || focused.closest("input, textarea, [contenteditable]:not([contenteditable='false'])"))) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const openSettings = (hash: string) => {
    onClose();
    void chrome.tabs.create({ url: chrome.runtime.getURL(`/options.html#${hash}`), active: true });
  };

  return <section aria-labelledby="whats-new-title" className="newtab-whats-new" role="dialog">
    <header className="newtab-whats-new-header">
      <span className="newtab-whats-new-icon"><Sparkles aria-hidden="true" size={16} /></span>
      <div>
        <h2 id="whats-new-title">What’s new</h2>
        <p>Volt {version}</p>
      </div>
      <button aria-label="Close what’s new" className="newtab-whats-new-close" onClick={onClose} type="button"><X size={16} /></button>
    </header>
    <ScrollAreaPrimitive.Root className="newtab-whats-new-scroll" type="hover">
      <ScrollAreaPrimitive.Viewport className="newtab-whats-new-viewport">
        <div className="newtab-whats-new-items">
          {RELEASE_NOTES.map((note) => <section className="newtab-whats-new-item" key={note.title}>
            <span className="newtab-whats-new-item-dot" aria-hidden="true" />
            <div><h3>{note.title}</h3><p>{note.description}</p></div>
          </section>)}
        </div>
        <div className="newtab-whats-new-links">
          {RELEASE_SETTINGS_LINKS.map((link) => <button key={link.hash} onClick={() => openSettings(link.hash)} type="button">{link.label}<ArrowUpRight aria-hidden="true" size={12} /></button>)}
        </div>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
    </ScrollAreaPrimitive.Root>
    <footer className="newtab-whats-new-footer">
      <button className="newtab-whats-new-done" onClick={onClose} type="button">Got it</button>
    </footer>
  </section>;
}
