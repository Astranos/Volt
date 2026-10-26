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
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let canceled = false;
    void chrome.storage.local.get([WHATS_NEW_SEEN_VERSION_KEY, WHATS_NEW_SEEN_NOTES_KEY]).then((stored) => {
      if (canceled) return;
      setOpen(shouldAnnounceRelease(stored[WHATS_NEW_SEEN_VERSION_KEY]));
      setUnread(stored[WHATS_NEW_SEEN_NOTES_KEY] !== RELEASE_NOTES_ID);
    });
    return () => { canceled = true; };
  }, []);

  const close = () => {
    setOpen(false);
    setUnread(false);
    void markReleaseNotesSeen(version);
  };

  return { version, open, unread, show: () => setOpen(true), close };
}

/** Non-modal card pinned to the bottom-right corner; the page stays usable behind it. */
export function WhatsNewDialog({ version, onClose }: { version: string; onClose: () => void }) {
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
