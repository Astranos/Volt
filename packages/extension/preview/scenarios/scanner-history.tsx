import "@/entrypoints/sidepanel/sidepanel.css";
import { CaptureBatchCard, EmptyHistory, LoadingHistory } from "@/src/components/sidepanel/mobile-scanner-cards";
import type { HydratedMobileScannerPhotoResult, MobileScannerScanResult } from "@/src/domain/mobile-scanner-results";
import { buildTimelineGroups, type TimelineEntry } from "@/src/domain/mobile-scanner-timeline";
import { productImages } from "../fixtures/shopify";
import { defineScenario } from "../scenario";

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function scan(batchId: string, id: string, minutesAgo: number, kind: "barcode" | "text", value: string): MobileScannerScanResult {
  const capturedAt = at(minutesAgo);
  return { type: "scan", id, kind, value, batchId, capturedAt, scan: { id, kind, barcode: value, scannedAt: capturedAt } };
}

function photo(batchId: string, id: string, minutesAgo: number, dataUrl: string): HydratedMobileScannerPhotoResult {
  const capturedAt = at(minutesAgo);
  return {
    type: "photo", id, batchId, photoBatchId: batchId, capturedAt,
    photo: { id, kind: "photo", photoBatchId: batchId, name: `${id}.jpg`, mimeType: "image/jpeg", size: 412_000, capturedAt, dataUrl },
  };
}

// Newest session first, like the panel. Within a session, entries arrive oldest first.
const entries: TimelineEntry[] = [
  scan("morning", "m1", 3, "barcode", "0045496882648"),
  photo("morning", "m2", 2.5, productImages.iphone13),
  photo("morning", "m3", 2.4, productImages.iphone13Pro),
  scan("morning", "m4", 2, "text", "Nintendo Switch OLED White"),
  scan("earlier", "e1", 95, "barcode", "0190199269749"),
  scan("earlier", "e2", 94, "barcode", "0711719541080"),
  photo("photos", "p1", 240, productImages.iphone13Mini),
  photo("photos", "p2", 239, productImages.iphone13ProMax),
];

const noop = () => {};

// ?state=loading | empty | signed-out; ?expanded=1 opens every session.
export default defineScenario({
  description: "Sidepanel scanner history cards (?state=loading|empty|signed-out, ?expanded=1)",
  viewport: { width: 380, height: 760 },
  fullPage: true,
  render: (params) => {
    const state = params.get("state");
    const groups = buildTimelineGroups(entries);
    return (
      <div id="volt-sidepanel-container" style={{ height: "100vh" }}>
        <div className="min-w-0 space-y-3 p-4">
          {state === "loading" ? <LoadingHistory />
            : state === "empty" || state === "signed-out" ? <EmptyHistory signedOut={state === "signed-out"} onSignIn={noop} />
            : groups.map((group) => (
              <CaptureBatchCard
                key={group.key} group={group} now={Date.now()} collapsed={!params.get("expanded")}
                removing={false} removingIds={new Set()} selectedPhotoIds={new Set()}
                onToggleCollapse={noop} onDeleteBatch={noop} onDeleteEntry={noop} onCopyScan={noop}
                onCopyPhoto={noop} onDownloadPhoto={noop} onPreviewPhoto={noop} onSendPhoto={noop}
                onDragStart={noop} onBatchDragStart={noop} onHover={noop} onToggleSelection={noop}
              />
            ))}
        </div>
      </div>
    );
  },
});
