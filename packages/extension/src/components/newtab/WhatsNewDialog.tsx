import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
import { notesForVersion, RELEASE_SETTINGS_LINKS } from "./release-notes";
import "./whats-new-dialog.css";

const SEEN_VERSION_KEY = "voltWhatsNewSeenVersion";

export function WhatsNewDialog({ openRequest = 0 }: { openRequest?: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [version] = useState(() => chrome.runtime.getManifest().version);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let canceled = false;
    void chrome.storage.local.get(SEEN_VERSION_KEY).then((stored) => {
      if (!canceled && stored[SEEN_VERSION_KEY] !== version) setOpen(true);
    });
    return () => { canceled = true; };
  }, [version]);

  useEffect(() => {
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    void chrome.storage.local.set({ [SEEN_VERSION_KEY]: version });
  };

  const openSettings = (hash: string) => {
    close();
    void chrome.tabs.create({ url: chrome.runtime.getURL(`/options.html#${hash}`), active: true });
  };

  return <dialog aria-labelledby="whats-new-title" className="newtab-whats-new-dialog" onClose={close} ref={dialogRef}>
    <div className="newtab-whats-new-topline">
      <span className="newtab-whats-new-icon"><Sparkles aria-hidden="true" size={20} /></span>
      <button aria-label="Close what’s new" className="newtab-whats-new-close" onClick={() => dialogRef.current?.close()} type="button"><X size={18} /></button>
    </div>
    <p className="newtab-whats-new-eyebrow">Volt · version {version}</p>
    <h2 id="whats-new-title">What’s new</h2>
    <p className="newtab-whats-new-lede">A faster way to find, review, and act on your products.</p>
    <div className="newtab-whats-new-items">
      {notesForVersion(version).map((note) => <section className="newtab-whats-new-item" key={note.title}>
        <span className="newtab-whats-new-item-dot" aria-hidden="true" />
        <div><h3>{note.title}</h3><p>{note.description}</p></div>
      </section>)}
    </div>
    <div className="newtab-whats-new-links">
      <span>Set it up</span>
      <div>{RELEASE_SETTINGS_LINKS.map((link) => <button key={link.hash} onClick={() => openSettings(link.hash)} type="button">{link.label}<ArrowUpRight aria-hidden="true" size={13} /></button>)}</div>
    </div>
    <button className="newtab-whats-new-done" onClick={() => dialogRef.current?.close()} type="button">Got it</button>
  </dialog>;
}
