import { useEffect, useState } from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
import { ScrollBar } from "../ui/scroll-area";
import { RELEASE_NOTES, RELEASE_SETTINGS_LINKS, shouldAnnounceRelease } from "./release-notes";
import "./whats-new-dialog.css";

const SEEN_VERSION_KEY = "voltWhatsNewSeenVersion";

/** Non-modal card pinned to the bottom-right corner; the page stays usable behind it. */
export function WhatsNewDialog({ openRequest = 0 }: { openRequest?: number }) {
  const [version] = useState(() => chrome.runtime.getManifest().version);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let canceled = false;
    void chrome.storage.local.get(SEEN_VERSION_KEY).then((stored) => {
      if (!canceled && shouldAnnounceRelease(stored[SEEN_VERSION_KEY])) setOpen(true);
    });
    return () => { canceled = true; };
  }, [version]);

  useEffect(() => {
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  const close = () => {
    setOpen(false);
    void chrome.storage.local.set({ [SEEN_VERSION_KEY]: version });
  };

  const openSettings = (hash: string) => {
    close();
    void chrome.tabs.create({ url: chrome.runtime.getURL(`/options.html#${hash}`), active: true });
  };

  if (!open) return null;

  return <section aria-labelledby="whats-new-title" className="newtab-whats-new" role="dialog">
    <header className="newtab-whats-new-header">
      <span className="newtab-whats-new-icon"><Sparkles aria-hidden="true" size={16} /></span>
      <div>
        <h2 id="whats-new-title">What’s new</h2>
        <p>Volt {version}</p>
      </div>
      <button aria-label="Close what’s new" className="newtab-whats-new-close" onClick={close} type="button"><X size={16} /></button>
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
      <button className="newtab-whats-new-done" onClick={close} type="button">Got it</button>
    </footer>
  </section>;
}
