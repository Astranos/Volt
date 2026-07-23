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

    var readyRecords: [CloudCaptureRecord] {
        let now = Date.now
        return records.filter { record in
            guard record.state != .uploaded else { return false }
            guard let nextAttemptAt = record.nextAttemptAt else { return true }
            return nextAttemptAt <= now
        }
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
                deliveryState: record.state == .uploaded ? .sent : (record.state == .failed ? .failed : .saved),
                imageData: try? photoData(for: record),
                batchId: record.batchId
            )
        }
        .sorted { $0.capturedAt > $1.capturedAt }
    }

    @discardableResult
    func enqueue(result: ScanResult, photoData: Data? = nil) throws -> CloudCaptureRecord {
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
        if let filename = records.first(where: { $0.id == id })?.photoFilename {
            try? fileManager.removeItem(at: directoryURL.appending(path: filename))
        }
        records.removeAll { $0.id == id }
        try save()
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
