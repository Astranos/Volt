import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const scanner = readFileSync(new URL('../ios/Volt/Views/ScannerView.swift', import.meta.url), 'utf8');
const rows = readFileSync(new URL('../ios/Volt/Views/CapturedResultRow.swift', import.meta.url), 'utf8');

test('executable Swift groups actual history declarations and preserves identities', {
  skip: process.platform !== 'darwin' ? 'requires macOS Swift toolchain' : false,
}, () => {
  const model = readFileSync(new URL('../ios/Volt/Models/ScanResult.swift', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../ios/Volt/Views/CaptureModeCards.swift', import.meta.url), 'utf8');
  // Extract whole production declarations, not a reimplementation of grouping.
  function between(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `Missing Swift declaration boundary: ${start}`);
    return source.slice(first, last);
  }
  const grouping = between(scanner, 'private func captureHistorySessions(', 'private struct CaptureHistorySessionCard:');
  const batches = between(cards, 'struct PhotoBatchIdentity:', 'struct PhotoSessionHistorySection:');
  const program = [model, batches, `
enum CaptureMode { case ocr, barcode, photo, dictation
    var title: String { String(describing: self) }
}
`, grouping, String.raw`
func item(_ number: Int, _ kind: ScanResult.Kind = .photo,
          _ batch: String? = "mixed", _ source: ScanResult.Source = .capture) -> ScanResult {
    ScanResult(id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", number))!,
               kind: kind, source: source, value: "fixture", format: "fixture",
               capturedAt: Date(timeIntervalSince1970: Double(number)), batchId: batch)
}
func ids(_ entries: [CaptureHistoryEntry]) -> [[UUID]] {
    entries.map { entry in
        switch entry {
        case .result(let result): return [result.id]
        case .photos(let batch): return batch.results.map(\.id)
        }
    }
}
let mixed = [item(1), item(2), item(3, .text), item(4), item(5, .barcode),
             item(6), item(7, .dictation), item(8), item(9, .photo, "mixed", .upload),
             item(10, .photo, "mixed", .upload), item(11)]
let sessions = captureHistorySessions(from: Array(mixed.reversed()))
precondition(sessions.count == 1)
let entries = sessions[0].entries
precondition(ids(entries) == [[1, 2], [3], [4], [5], [6], [7], [8], [9, 10], [11]].map {
    $0.map { mixed[$0 - 1].id }
}, "photo runs must stop at text/barcode/audio and source boundaries")
precondition(entries.map(\.id) == [1, 3, 4, 5, 6, 7, 8, 9, 11].map { mixed[$0 - 1].id })
precondition(Set(entries.map(\.id)).count == entries.count, "separate runs need unique IDs")
precondition(ids(entries).flatMap { $0 } == mixed.map(\.id), "no loss or reordering")
let refreshed = captureHistorySessions(from: mixed)[0].entries
precondition(refreshed.map(\.id) == entries.map(\.id), "IDs must survive recomputation")
let deleted = captureHistorySessions(from: mixed.filter { $0.id != mixed[1].id })[0].entries
precondition(deleted.map(\.id) == entries.map(\.id), "deleting a non-leading photo preserves run IDs")
let appended = captureHistorySessions(from: mixed + [item(12)])[0].entries
precondition(appended.map(\.id) == entries.map(\.id), "appending photos preserves run IDs")
let legacy = [item(20, .photo, nil), item(21, .photo, nil)]
let legacySessions = captureHistorySessions(from: legacy)
precondition(legacySessions.count == 2)
precondition(legacySessions.map(\.id) == legacy.reversed().map { $0.id.uuidString.lowercased() })
precondition(legacySessions.allSatisfy { $0.results.count == 1 && $0.entries.count == 1 })
let listing = (30...34).map { item($0, .photo, "listingBatch", .upload) }
let shipping = (40...41).map { item($0, .photo, "shippingBatch", .upload) }
let uploads = captureHistorySessions(from: Array((listing + shipping).reversed()))
precondition(uploads.map(\.id) == ["shippingBatch", "listingBatch"])
precondition(uploads.map { ids($0.entries).map(\.count) } == [[2], [5]])
for session in sessions + legacySessions + uploads {
    for entry in session.entries {
        if case .photos(let batch) = entry {
            precondition(!batch.results.isEmpty, "photo entries must never contain empty batches")
            precondition(entry.id == batch.results[0].id)
        }
    }
}
precondition(captureHistorySessions(from: []).isEmpty)
print("photo batch history Swift fixtures passed")
`].join('\n');
  // Swift interprets stdin; no iOS/UI build or persistent fixture files needed.
  const output = execFileSync('xcrun', ['swift', '-'], {
    input: program, encoding: 'utf8', timeout: 60_000, stdio: 'pipe',
  });
  assert.equal(output.trim(), 'photo batch history Swift fixtures passed');
});

test('both history surfaces use the shared card with photo runs instead of individual photo rows', () => {
  assert.equal((scanner.match(/CaptureHistorySessionCard\(/g) ?? []).length, 2);
  assert.match(scanner, /ForEach\(session\.entries\)/);
  assert.match(scanner, /case \.photos\(let batch\):[\s\S]*CaptureHistoryPhotoBatch/);
  assert.doesNotMatch(scanner, /ForEach\(session\.results\)/);
});

test('photo runs stop at non-photos and source changes, keeping mixed capture order', () => {
  assert.match(scanner, /for result in results/);
  assert.match(scanner, /if result\.kind == \.photo/);
  assert.match(scanner, /case \.photos\(let batch\) = entries\.last/);
  assert.match(scanner, /batch\.source == result\.source/);
  assert.match(scanner, /batch\.results \+ \[result\]/);
  assert.match(scanner, /entries\.append\(\.result\(result\)\)/);
  assert.match(scanner, /results: \$0\.value\.sorted \{ \$0\.capturedAt < \$1\.capturedAt \}/);
});

test('compact photos retain expandable gallery, preview, resend and delete', () => {
  assert.match(rows, /Array\(batch\.results\.suffix\(4\)\)/);
  assert.match(rows, /LazyVGrid/);
  assert.match(rows, /adaptive\(minimum: 96, maximum: 112\)/);
  assert.match(rows, /View all/);
  assert.match(rows, /sheet\(item: \$previewedPhoto\)/);
  assert.match(rows, /onResend\(result\)/);
  assert.match(rows, /onDelete\(result\)/);
  assert.match(rows, /Preview photo/);
});
