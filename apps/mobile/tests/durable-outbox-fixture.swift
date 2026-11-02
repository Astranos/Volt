import Foundation
import ImageIO
import UniformTypeIdentifiers

@main
struct DurableOutboxFixture {
    @MainActor
    static func main() throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let photo = ScanResult(kind: .photo, value: "photo", format: "jpeg", batchId: "session-a")
        let bytes = Data([0xFF, 0xD8, 0xFF, 0xD9])
        let initial = DurableCaptureOutbox(directoryURL: directory)
        try initial.enqueue(result: photo, photoData: bytes, ownerClerkUserId: "alice", workspaceId: "alice-workspace")
        try initial.enqueue(result: photo, photoData: bytes, ownerClerkUserId: "alice", workspaceId: "alice-workspace")
        precondition(initial.records.count == 1, "enqueue must deduplicate stable capture IDs")
        try initial.markSyncing(id: photo.id)

        let restored = DurableCaptureOutbox(directoryURL: directory)
        precondition(restored.records.count == 1)
        let record = restored.records[0]
        precondition(record.state == .failed, "interrupted uploads must be retryable after relaunch")
        precondition(record.nextAttemptAt == nil)
        precondition(record.idempotencyKey == photo.id.uuidString.lowercased())
        let restoredBytes = try restored.photoData(for: record)
        precondition(restoredBytes == bytes, "photo bytes must survive relaunch")
        precondition(restored.restoredResults[0].imageData == bytes)
        precondition(restored.readyRecords(ownerClerkUserId: "alice").map(\.id) == [photo.id])
        precondition(restored.readyRecords(ownerClerkUserId: "bob").isEmpty)

        let anonymous = ScanResult(kind: .text, value: "serial", format: "text", batchId: "session-b")
        try restored.enqueue(result: anonymous, ownerClerkUserId: nil, workspaceId: nil)
        try restored.reconcileOwnership(ownerClerkUserId: "bob", workspaceId: "bob-workspace")
        precondition(restored.readyRecords(ownerClerkUserId: "bob").isEmpty,
                     "a new account must not claim captures when a foreign owner exists")
        precondition(restored.records.allSatisfy { $0.state == .held })
        precondition(Set(restored.pendingOwnershipConflicts(for: "bob").map(\.id)) == [photo.id, anonymous.id])

        try restored.attach(ids: [anonymous.id], ownerClerkUserId: "bob", workspaceId: "bob-workspace")
        precondition(restored.readyRecords(ownerClerkUserId: "bob").map(\.id) == [anonymous.id])
        try restored.retain(ids: [photo.id])
        try restored.reconcileOwnership(ownerClerkUserId: "alice", workspaceId: "alice-workspace")
        precondition(restored.readyRecords(ownerClerkUserId: "alice").isEmpty,
                     "keep-local decisions must survive account reconciliation")

        try restored.attach(ids: [photo.id], ownerClerkUserId: "alice", workspaceId: "alice-workspace")
        let failureTime = Date(timeIntervalSince1970: 1_000)
        try restored.markFailed(id: photo.id, now: failureTime)
        let failed = restored.records.first { $0.id == photo.id }!
        precondition(failed.attemptCount == 1)
        precondition(failed.nextAttemptAt == failureTime.addingTimeInterval(2))
        try restored.markFailed(id: photo.id, now: Date.now.addingTimeInterval(3_600))
        precondition(restored.readyRecords(ownerClerkUserId: "alice").isEmpty,
                     "future retry deadlines must prevent immediate replay")

        try restored.markUploaded(id: photo.id)
        let keptBytes = try restored.photoData(for: restored.records.first { $0.id == photo.id }!)
        precondition(keptBytes == bytes,
                     "an upload that can't be downscaled keeps its original bytes for history")

        let large = ScanResult(kind: .photo, value: "large", format: "jpeg", batchId: "session-a")
        let largeBytes = jpeg(width: 4_000, height: 3_000)
        try restored.enqueue(result: large, photoData: largeBytes, ownerClerkUserId: "alice", workspaceId: "alice-workspace")
        try restored.markUploaded(id: large.id)

        let delivered = DurableCaptureOutbox(directoryURL: directory)
        precondition(delivered.records.first { $0.id == photo.id }?.state == .uploaded)
        precondition(delivered.readyRecords(ownerClerkUserId: "alice").isEmpty)
        let history = delivered.restoredResults.first { $0.id == large.id }?.imageData
        precondition(history != nil, "uploaded photos must stay visible in history after relaunch")
        precondition(history!.count < largeBytes.count, "uploaded photos are kept as a smaller preview")
        precondition(longEdge(of: history!) == DurableCaptureOutbox.historyPreviewMaxPixelSize)
        try delivered.remove(ids: [photo.id, anonymous.id, large.id])
        precondition(delivered.exportPhotoURLs(for: [large.id]).isEmpty)
        precondition(DurableCaptureOutbox(directoryURL: directory).records.isEmpty,
                     "deletion must persist across relaunch")
        print("durable outbox fixtures passed")
    }

    static func jpeg(width: Int, height: Int) -> Data {
        let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        )!
        for index in 0..<40 {
            context.setFillColor(red: CGFloat(index % 5) / 4, green: CGFloat(index % 7) / 6, blue: CGFloat(index % 3) / 2, alpha: 1)
            context.fill(CGRect(x: index * 97 % width, y: index * 61 % height, width: 400, height: 300))
        }
        let output = NSMutableData()
        let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, context.makeImage()!, nil)
        precondition(CGImageDestinationFinalize(destination))
        return output as Data
    }

    static func longEdge(of data: Data) -> Int {
        let source = CGImageSourceCreateWithData(data as CFData, nil)!
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as! [CFString: Any]
        return max(properties[kCGImagePropertyPixelWidth] as! Int, properties[kCGImagePropertyPixelHeight] as! Int)
    }
}
