import Foundation

@MainActor
final class DurableCaptureOutbox {
    private struct Manifest: Codable {
        var records: [CloudCaptureRecord]
    }

    private let fileManager: FileManager
    private let directoryURL: URL
    private let manifestURL: URL
    private(set) var records: [CloudCaptureRecord] = []

    init(fileManager: FileManager = .default, directoryURL: URL? = nil) {
        self.fileManager = fileManager
        self.directoryURL = directoryURL ?? URL.applicationSupportDirectory
            .appending(path: "VoltCaptureOutbox", directoryHint: .isDirectory)
        self.manifestURL = self.directoryURL.appending(path: "manifest.json")
        load()
    }

    var restoredResults: [ScanResult] {
        records.compactMap { record in
            guard let kind = ScanResult.Kind(rawValue: record.kind),
                  let source = ScanResult.Source(rawValue: record.source)
            else { return nil }
            return ScanResult(
                id: record.id,
                kind: kind,
                source: source,
                value: record.value,
                format: record.format,
                capturedAt: record.capturedAt,
                deliveryState: deliveryState(for: record),
                imageData: try? photoData(for: record),
                batchId: record.batchId
            )
        }
        .sorted { $0.capturedAt > $1.capturedAt }
    }

    func readyRecords(ownerClerkUserId: String) -> [CloudCaptureRecord] {
        let now = Date.now
        return records.filter { record in
            guard record.ownerClerkUserId == ownerClerkUserId,
                  record.state != .uploaded,
                  record.state != .held
            else { return false }
            guard let nextAttemptAt = record.nextAttemptAt else { return true }
            return nextAttemptAt <= now
        }
    }

    func pendingOwnershipConflicts(for ownerClerkUserId: String) -> [CloudCaptureRecord] {
        records.filter { record in
            guard record.state != .uploaded, record.retainedLocally != true else { return false }
            return record.ownerClerkUserId == nil || record.ownerClerkUserId != ownerClerkUserId
        }
    }

    @discardableResult
    func enqueue(
        result: ScanResult,
        photoData: Data? = nil,
        ownerClerkUserId: String?,
        workspaceId: String?
    ) throws -> CloudCaptureRecord {
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        let storedFilename = photoData == nil ? nil : "\(result.id.uuidString.lowercased()).jpg"
        if let photoData, let storedFilename {
            try photoData.write(to: directoryURL.appending(path: storedFilename), options: [.atomic, .completeFileProtection])
        }
        let record = CloudCaptureRecord(
            id: result.id,
            kind: result.kind.rawValue,
            source: result.source.rawValue,
            value: result.value,
            format: result.format,
            capturedAt: result.capturedAt,
            batchId: result.batchId ?? result.id.uuidString.lowercased(),
            photoFilename: storedFilename,
            photoContentType: storedFilename == nil ? nil : "image/jpeg",
            ownerClerkUserId: ownerClerkUserId,
            workspaceId: workspaceId,
            retainedLocally: false,
            state: .pending,
            attemptCount: 0,
            nextAttemptAt: nil
        )
        records.removeAll { $0.id == record.id }
        records.append(record)
        do {
            try save()
            return record
        } catch {
            records.removeAll { $0.id == record.id }
            if let storedFilename {
                try? fileManager.removeItem(at: directoryURL.appending(path: storedFilename))
            }
            throw error
        }
    }

    func photoData(for record: CloudCaptureRecord) throws -> Data? {
        guard let filename = record.photoFilename else { return nil }
        return try Data(contentsOf: directoryURL.appending(path: filename))
    }

    func reconcileOwnership(ownerClerkUserId: String, workspaceId: String) throws {
        let hasForeignOwner = records.contains { record in
            record.state != .uploaded
                && record.retainedLocally != true
                && record.ownerClerkUserId != nil
                && record.ownerClerkUserId != ownerClerkUserId
        }
        for index in records.indices where records[index].state != .uploaded {
            if records[index].ownerClerkUserId == ownerClerkUserId {
                if records[index].state == .held && records[index].retainedLocally != true {
                    records[index].state = .pending
                    records[index].nextAttemptAt = nil
                }
                continue
            }
            if records[index].ownerClerkUserId == nil && !hasForeignOwner {
                records[index].ownerClerkUserId = ownerClerkUserId
                records[index].workspaceId = workspaceId
                records[index].retainedLocally = false
                records[index].state = .pending
                records[index].nextAttemptAt = nil
            } else {
                records[index].state = .held
                records[index].nextAttemptAt = nil
            }
        }
        try save()
    }

    func pauseUploads() throws {
        for index in records.indices where records[index].state != .uploaded {
            records[index].state = .held
            records[index].nextAttemptAt = nil
        }
        try save()
    }

    func retain(ids: Set<UUID>) throws {
        for index in records.indices where ids.contains(records[index].id) {
            records[index].state = .held
            records[index].retainedLocally = true
            records[index].nextAttemptAt = nil
        }
        try save()
    }

    func attach(ids: Set<UUID>, ownerClerkUserId: String, workspaceId: String) throws {
        for index in records.indices where ids.contains(records[index].id) {
            records[index].ownerClerkUserId = ownerClerkUserId
            records[index].workspaceId = workspaceId
            records[index].retainedLocally = false
            records[index].state = .pending
            records[index].attemptCount = 0
            records[index].nextAttemptAt = nil
        }
        try save()
    }

    func remove(ids: Set<UUID>) throws {
        for record in records where ids.contains(record.id) {
            if let filename = record.photoFilename {
                try? fileManager.removeItem(at: directoryURL.appending(path: filename))
            }
        }
        records.removeAll { ids.contains($0.id) }
        try save()
    }

    func exportPhotoURLs(for ids: Set<UUID>) -> [URL] {
        records.compactMap { record in
            guard ids.contains(record.id), let filename = record.photoFilename else { return nil }
            let url = directoryURL.appending(path: filename)
            return fileManager.fileExists(atPath: url.path) ? url : nil
        }
    }

    func exportText(for ids: Set<UUID>) -> String {
        let selected = records
            .filter { ids.contains($0.id) }
            .sorted { $0.capturedAt < $1.capturedAt }
        guard let data = try? Self.encoder.encode(selected),
              let text = String(data: data, encoding: .utf8)
        else { return "[]" }
        return text
    }

    func markSyncing(id: UUID) throws { try update(id: id, state: .syncing, retryAt: nil) }

    func markUploaded(id: UUID) throws {
        try update(id: id, state: .uploaded, retryAt: nil)
        if let filename = records.first(where: { $0.id == id })?.photoFilename {
            try? fileManager.removeItem(at: directoryURL.appending(path: filename))
        }
    }

    func markFailed(id: UUID, now: Date = .now) throws {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return }
        records[index].attemptCount += 1
        let exponent = min(records[index].attemptCount, 8)
        let delay = min(pow(2, Double(exponent)), 300)
        records[index].state = .failed
        records[index].nextAttemptAt = now.addingTimeInterval(delay)
        try save()
    }

    func remove(id: UUID) throws {
        try remove(ids: Set([id]))
    }

    private func deliveryState(for record: CloudCaptureRecord) -> ScanResult.DeliveryState {
        switch record.state {
        case .uploaded:
            .sent
        case .failed:
            .failed
        case .pending, .syncing, .held:
            .saved
        }
    }

    private func update(id: UUID, state: CloudCaptureRecord.State, retryAt: Date?) throws {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return }
        records[index].state = state
        records[index].nextAttemptAt = retryAt
        try save()
    }

    private func load() {
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? Self.decoder.decode(Manifest.self, from: data)
        else { return }
        records = manifest.records.map { record in
            guard record.state == .syncing else { return record }
            var retryable = record
            retryable.state = .failed
            retryable.nextAttemptAt = nil
            return retryable
        }
    }

    private func save() throws {
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        let data = try Self.encoder.encode(Manifest(records: records))
        try data.write(to: manifestURL, options: [.atomic, .completeFileProtection])
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
