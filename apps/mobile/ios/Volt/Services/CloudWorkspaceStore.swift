import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class CloudWorkspaceStore {
    private(set) var credential: CloudDeviceCredential?
    private(set) var isEnrolling = false
    private(set) var isSyncing = false
    private(set) var lastError: String?

    @ObservationIgnored private let api: MobileCloudAPI
    @ObservationIgnored private let outbox: DurableCaptureOutbox
    @ObservationIgnored private var syncTask: Task<Void, Never>?
    @ObservationIgnored private var retryTask: Task<Void, Never>?

    init(
        api: MobileCloudAPI = MobileCloudAPIClient(baseURL: AppConfiguration.convexSiteURL),
        outbox: DurableCaptureOutbox? = nil
    ) {
        self.api = api
        self.outbox = outbox ?? DurableCaptureOutbox()
        self.credential = DeviceCredentialStore.load()
    }

    var workspaceId: String? { credential?.workspaceId }
    var pendingCount: Int { outbox.records.count { $0.state != .uploaded } }
    var restoredResults: [ScanResult] { outbox.restoredResults }

    func persist(_ result: ScanResult, photoData: Data? = nil) throws {
        try outbox.enqueue(result: result, photoData: photoData)
        requestSync()
    }

    func remove(resultId: UUID) {
        try? outbox.remove(id: resultId)
    }

    func enroll(_ enrollment: DeviceEnrollment) async {
        guard !isEnrolling else { return }
        isEnrolling = true
        defer { isEnrolling = false }
        do {
            let response = try await api.exchangeEnrollment(DeviceEnrollmentRequest(
                enrollmentCode: enrollment.token,
                label: UIDevice.current.name
            ))
            let credential = CloudDeviceCredential(
                value: response.deviceSecret,
                deviceId: response.deviceId,
                workspaceId: response.workspaceId,
                enrolledAt: .now
            )
            try DeviceCredentialStore.save(credential)
            self.credential = credential
            lastError = nil
            requestSync()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func revokeLocalCredential() {
        try? DeviceCredentialStore.remove()
        credential = nil
        syncTask?.cancel()
        syncTask = nil
        retryTask?.cancel()
        retryTask = nil
    }

    func requestSync() {
        guard credential != nil, syncTask == nil else { return }
        retryTask?.cancel()
        retryTask = nil
        syncTask = Task { [weak self] in
            await self?.drainOutbox()
        }
    }

    private func drainOutbox() async {
        isSyncing = true
        defer {
            isSyncing = false
            syncTask = nil
            scheduleRetryIfNeeded()
        }
        guard let credential else { return }
        let batches = Dictionary(grouping: outbox.readyRecords, by: \.batchId)
            .values
            .sorted { ($0.first?.capturedAt ?? .distantPast) < ($1.first?.capturedAt ?? .distantPast) }
        for records in batches {
            guard !Task.isCancelled else { return }
            do {
                for record in records { try outbox.markSyncing(id: record.id) }
                var photoDataByResult: [UUID: Data] = [:]
                for record in records {
                    photoDataByResult[record.id] = try outbox.photoData(for: record)
                }
                _ = try await api.putBatch(batchRequest(
                    for: records,
                    photoDataByResult: photoDataByResult,
                    credential: credential
                ))
                for record in records {
                    guard let photoData = photoDataByResult[record.id] else { continue }
                    let upload = try await api.createPhotoUploadURL(CreatePhotoUploadURLRequest(
                        deviceId: credential.deviceId,
                        deviceSecret: credential.value,
                        batchId: record.batchId,
                        resultId: record.id.uuidString.lowercased(),
                        contentType: record.photoContentType ?? "image/jpeg",
                        byteCount: photoData.count
                    ))
                    try await api.uploadPhoto(photoData, using: upload)
                }
                if let batchId = records.first?.batchId {
                    try await api.markBatchReady(MarkCloudBatchReadyRequest(
                        deviceId: credential.deviceId,
                        deviceSecret: credential.value,
                        batchId: batchId
                    ))
                }
                for record in records { try outbox.markUploaded(id: record.id) }
                lastError = nil
            } catch MobileCloudError.credentialRevoked {
                revokeLocalCredential()
                lastError = MobileCloudError.credentialRevoked.localizedDescription
                return
            } catch {
                for record in records { try? outbox.markFailed(id: record.id) }
                lastError = error.localizedDescription
            }
        }
    }

    private func scheduleRetryIfNeeded() {
        guard credential != nil,
              let retryAt = outbox.records.compactMap(\.nextAttemptAt).min()
        else { return }
        let delay = max(0, retryAt.timeIntervalSinceNow)
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.retryTask = nil
            self?.requestSync()
        }
    }

    private func batchRequest(
        for records: [CloudCaptureRecord],
        photoDataByResult: [UUID: Data],
        credential: CloudDeviceCredential
    ) -> PutCloudBatchRequest {
        let createdAt = records.map(\.capturedAt).min() ?? .now
        return PutCloudBatchRequest(
            deviceId: credential.deviceId,
            deviceSecret: credential.value,
            batchId: records.first?.batchId ?? UUID().uuidString.lowercased(),
            clientCreatedAt: createdAt.timeIntervalSince1970 * 1_000,
            results: records.map { record in
                CloudResultInput(
                    resultId: record.idempotencyKey,
                    kind: record.kind,
                    text: record.kind == "photo" ? nil : record.value,
                    format: record.format,
                    contentType: record.photoContentType,
                    byteCount: photoDataByResult[record.id]?.count ?? 0,
                    checksum: nil,
                    clientCreatedAt: record.capturedAt.timeIntervalSince1970 * 1_000
                )
            }
        )
    }
}
