import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CaptureBatchCard } from "./mobile-scanner-cards";
import { buildTimelineGroups, type TimelineEntry } from "../../domain/mobile-scanner-timeline";

const capturedAt = "2026-09-12T12:00:00.000Z";

function photo(id: string): TimelineEntry {
  return {
    type: "photo", id, batchId: "session", photoBatchId: "session", capturedAt,
    photo: { id, kind: "photo", photoBatchId: "session", name: `${id}.jpg`, mimeType: "image/jpeg", size: 100, capturedAt, dataUrl: "data:image/jpeg;base64,AA==" },
  };
}

function scan(kind: "text" | "barcode"): TimelineEntry {
  return {
    type: "scan", id: kind, kind, batchId: "session", capturedAt, value: `value-${kind}`,
    scan: { id: kind, kind, barcode: `value-${kind}`, scannedAt: capturedAt },
  };
}

function card(entries: TimelineEntry[], collapsed = true): React.ReactElement<React.ComponentProps<typeof CaptureBatchCard>> {
  const [group] = buildTimelineGroups(entries);
  if (!group) throw new Error("Fixture requires a capture group");
  return <CaptureBatchCard
    group={group} now={Date.parse(capturedAt)} collapsed={collapsed} removing={false}
    removingIds={new Set()} selectedPhotoIds={new Set()}
    onToggleCollapse={vi.fn()} onDeleteBatch={vi.fn()} onDeleteEntry={vi.fn()}
    onCopyScan={vi.fn()} onCopyPhoto={vi.fn()} onDownloadPhoto={vi.fn()}
    onPreviewPhoto={vi.fn()} onSendPhoto={vi.fn()} onDragStart={vi.fn()}
    onBatchDragStart={vi.fn()} onHover={vi.fn()} onToggleSelection={vi.fn()}
  />;
}

describe("capture session photo batches", () => {
  it("defaults the parent photo preview to collapsed even in mixed sessions", () => {
    const source = readFileSync(new URL("./MobileScanner.tsx", import.meta.url), "utf8");
    expect(source).toContain("collapsed={!expandedBatchIds.has(group.key)}");
  });

  it.each(["text", "barcode"] as const)("keeps photos compact and draggable alongside %s", (kind) => {
    const markup = renderToStaticMarkup(card([photo("first"), scan(kind), photo("second")]));
    expect(markup).toContain('aria-label="Drag 2 photo batch"');
    expect(markup).toContain('draggable="true"');
    expect(markup).toContain(`value-${kind}`);
    expect(markup).toContain("3 captures");
    expect(markup).toContain("2 photos");
  });

  it("counts only photos and shows overflow without hiding scans", () => {
    const markup = renderToStaticMarkup(card([
      ...Array.from({ length: 6 }, (_, i) => photo(`photo-${i}`)), scan("text"), scan("barcode"),
    ]));
    expect(markup).toContain('aria-label="Drag 6 photo batch"');
    expect(markup.match(/<img /g)).toHaveLength(4);
    expect(markup).toContain("+2");
    expect(markup).toContain("value-text");
    expect(markup).toContain("value-barcode");
  });

  it("expands photos into a grid while retaining text and barcode cards", () => {
    const markup = renderToStaticMarkup(card([photo("first"), scan("text"), photo("second"), scan("barcode")], false));
    expect(markup).toContain("grid grid-cols-2 gap-2");
    expect(markup).toContain('aria-label="Collapse photo batch"');
    expect(markup).toContain("value-text");
    expect(markup).toContain("value-barcode");
  });

  it("keeps existing photo-only batches and scan-only sessions working", () => {
    expect(renderToStaticMarkup(card([photo("first"), photo("second")]))).toContain('aria-label="Drag 2 photo batch"');
    const markup = renderToStaticMarkup(card([scan("text"), scan("barcode")]));
    expect(markup).not.toContain("Drag batch");
    expect(markup).not.toContain("Collapse photo batch");
    expect(markup).toContain("value-text");
    expect(markup).toContain("value-barcode");
  });

  it("allows a single photo to collapse again without hiding its session scans", () => {
    const markup = renderToStaticMarkup(card([photo("first"), scan("text")], false));
    expect(markup).toContain('aria-label="Collapse photo batch"');
    expect(markup).toContain("value-text");
  });

  it("wires the mixed photo preview to batch drag and collapse callbacks", () => {
    const element = card([photo("first"), scan("text"), photo("second")]);
    const drag = vi.fn();
    const toggle = vi.fn();
    const tree = CaptureBatchCard({ ...element.props, onBatchDragStart: drag, onToggleCollapse: toggle });
    const previews: React.ReactElement<{
      entries: TimelineEntry[];
      totalCount: number;
      onDragStart: () => void;
      onToggleCollapse: () => void;
    }>[] = [];
    function visit(node: React.ReactNode) {
      React.Children.forEach(node, (child) => {
        if (!React.isValidElement<{ children?: React.ReactNode; entries: TimelineEntry[]; totalCount: number; onDragStart: () => void; onToggleCollapse: () => void }>(child)) return;
        if (child.props.onDragStart === drag) previews.push(child);
        visit(child.props.children);
      });
    }
    visit(tree);
    expect(previews).toHaveLength(1);
    expect(previews[0].props.entries.map((entry) => entry.id)).toEqual(["first", "second"]);
    expect(previews[0].props.totalCount).toBe(2);
    previews[0].props.onDragStart();
    previews[0].props.onToggleCollapse();
    expect(drag).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledOnce();
  });
});
